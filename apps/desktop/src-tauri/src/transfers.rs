use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    task,
};
use tokio_util::{io::ReaderStream, sync::CancellationToken};

const STORE_FILE: &str = "stagepilot-transfer-paths.json";
const MAX_FILE_BYTES: u64 = 2_000_000_000;

#[derive(Clone, Serialize, Deserialize)]
struct PathRecord {
    path: PathBuf,
    kind: String,
}

#[derive(Default)]
pub struct TransferState {
    paths: Mutex<HashMap<String, PathRecord>>,
    aborts: Mutex<HashMap<String, CancellationToken>>,
    client: reqwest::Client,
}

#[derive(Serialize)]
pub struct PickedFile {
    id: String,
    filename: String,
    size_bytes: u64,
    modified_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    bytes: u64,
    total: u64,
}

#[derive(Serialize)]
pub struct FileDigest {
    sha256: String,
    size_bytes: u64,
    modified_ms: u64,
}

fn modified_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn source_metadata(path: &Path) -> Result<(u64, u64), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("无法读取本地文件：{e}"))?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_FILE_BYTES {
        return Err("本地文件为空或超过 2 GB 上限".into());
    }
    Ok((meta.len(), modified_ms(&meta)))
}

impl TransferState {
    pub fn restore(app: &AppHandle) -> Self {
        let paths = app
            .store(STORE_FILE)
            .ok()
            .and_then(|store| store.get("paths"))
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("build transfer HTTP client");
        Self {
            paths: Mutex::new(paths),
            aborts: Mutex::new(HashMap::new()),
            client,
        }
    }

    fn path(&self, id: &str, kind: &str) -> Result<PathBuf, String> {
        let guard = self.paths.lock().map_err(|e| e.to_string())?;
        guard
            .get(id)
            .filter(|record| record.kind == kind)
            .map(|record| record.path.clone())
            .ok_or_else(|| "传输文件已失效，请重新选择".into())
    }

    fn insert(&self, app: &AppHandle, id: String, record: PathRecord) -> Result<(), String> {
        let mut guard = self.paths.lock().map_err(|e| e.to_string())?;
        guard.insert(id, record);
        let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
        store.set(
            "paths",
            serde_json::to_value(&*guard).map_err(|e| e.to_string())?,
        );
        store.save().map_err(|e| e.to_string())
    }

    fn forget(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let mut guard = self.paths.lock().map_err(|e| e.to_string())?;
        guard.remove(id);
        let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
        store.set(
            "paths",
            serde_json::to_value(&*guard).map_err(|e| e.to_string())?,
        );
        store.save().map_err(|e| e.to_string())
    }

    fn abort_token(&self, task_id: &str) -> Result<CancellationToken, String> {
        let mut guard = self.aborts.lock().map_err(|e| e.to_string())?;
        Ok(guard
            .entry(task_id.to_string())
            .or_insert_with(CancellationToken::new)
            .clone())
    }

    pub fn abort_all(&self) {
        if let Ok(guard) = self.aborts.lock() {
            for token in guard.values() {
                token.cancel();
            }
        }
    }
}

#[tauri::command]
pub async fn transfer_pick_files(
    app: AppHandle,
    state: State<'_, TransferState>,
    multiple: bool,
) -> Result<Vec<PickedFile>, String> {
    let dialog_app = app.clone();
    let paths = task::spawn_blocking(move || {
        if multiple {
            dialog_app
                .dialog()
                .file()
                .blocking_pick_files()
                .unwrap_or_default()
        } else {
            dialog_app
                .dialog()
                .file()
                .blocking_pick_file()
                .into_iter()
                .collect()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for selected in paths {
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let (size_bytes, modified_ms) = source_metadata(&path)?;
        let id = uuid::Uuid::new_v4().to_string();
        let filename = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".into());
        state.insert(
            &app,
            id.clone(),
            PathRecord {
                path,
                kind: "source".into(),
            },
        )?;
        result.push(PickedFile {
            id,
            filename,
            size_bytes,
            modified_ms,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn transfer_pick_destination(
    app: AppHandle,
    state: State<'_, TransferState>,
    filename: String,
) -> Result<Option<String>, String> {
    let dialog_app = app.clone();
    let name = Path::new(&filename)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let selected = task::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_file_name(name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    if path.exists() {
        return Err("目标文件已存在，请另选保存位置或文件名".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    state.insert(
        &app,
        id.clone(),
        PathRecord {
            path,
            kind: "destination".into(),
        },
    )?;
    Ok(Some(id))
}

#[tauri::command]
pub fn transfer_forget(
    app: AppHandle,
    state: State<'_, TransferState>,
    id: String,
) -> Result<(), String> {
    state.forget(&app, &id)
}

#[tauri::command]
pub fn transfer_abort(state: State<'_, TransferState>, task_id: String) {
    if let Ok(guard) = state.aborts.lock() {
        if let Some(token) = guard.get(&task_id) {
            token.cancel();
        }
    }
}

#[tauri::command]
pub fn transfer_reset_abort(state: State<'_, TransferState>, task_id: String) {
    if let Ok(mut guard) = state.aborts.lock() {
        guard.insert(task_id, CancellationToken::new());
    }
}

#[tauri::command]
pub fn transfer_finish_task(state: State<'_, TransferState>, task_id: String) {
    if let Ok(mut guard) = state.aborts.lock() {
        guard.remove(&task_id);
    }
}

#[tauri::command]
pub async fn transfer_hash_source(
    state: State<'_, TransferState>,
    source_id: String,
    on_progress: Channel<Progress>,
) -> Result<FileDigest, String> {
    let path = state.path(&source_id, "source")?;
    task::spawn_blocking(move || {
        let (size, modified) = source_metadata(&path)?;
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        let mut read = 0u64;
        loop {
            let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
            read += count as u64;
            if read % (16 * 1024 * 1024) < count as u64 || read == size {
                let _ = on_progress.send(Progress {
                    bytes: read,
                    total: size,
                });
            }
        }
        if source_metadata(&path)? != (size, modified) || read != size {
            return Err("本地文件在读取期间发生变化".into());
        }
        Ok(FileDigest {
            sha256: format!("{:x}", hash.finalize()),
            size_bytes: size,
            modified_ms: modified,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn transfer_hash_part(
    state: State<'_, TransferState>,
    source_id: String,
    offset: u64,
    length: u64,
) -> Result<String, String> {
    let path = state.path(&source_id, "source")?;
    task::spawn_blocking(move || {
        let (size, _) = source_metadata(&path)?;
        if length == 0
            || length > 64 * 1024 * 1024
            || offset.checked_add(length).is_none_or(|end| end > size)
        {
            return Err("文件分段范围无效".into());
        }
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut limited = file.take(length);
        let mut hash = Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = limited.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        if limited.limit() != 0 {
            return Err("本地文件读取不完整".into());
        }
        Ok(STANDARD.encode(hash.finalize()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_signed_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "文件传输地址无效")?;
    let loopback = url
        .host_str()
        .is_some_and(|host| host == "localhost" || host == "127.0.0.1" || host == "[::1]");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("文件传输地址必须使用 HTTPS".into());
    }
    if url.username() != "" || url.password().is_some() {
        return Err("文件传输地址无效".into());
    }
    Ok(url)
}

fn report_stream<R>(
    reader: R,
    total: u64,
    progress: Channel<Progress>,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let count = AtomicU64::new(0);
    ReaderStream::new(reader).map(move |chunk| {
        if let Ok(ref data) = chunk {
            let bytes = count.fetch_add(data.len() as u64, Ordering::Relaxed) + data.len() as u64;
            let _ = progress.send(Progress { bytes, total });
        }
        chunk
    })
}

#[tauri::command]
pub async fn transfer_send_part(
    state: State<'_, TransferState>,
    task_id: String,
    source_id: String,
    url: String,
    headers: HashMap<String, String>,
    offset: u64,
    length: u64,
    checksum: String,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let path = state.path(&source_id, "source")?;
    let (size, _) = source_metadata(&path)?;
    if length == 0
        || length > 64 * 1024 * 1024
        || offset.checked_add(length).is_none_or(|end| end > size)
    {
        return Err("分段范围无效".into());
    }
    if headers.get("x-amz-checksum-sha256") != Some(&checksum) {
        return Err("签名与分段校验值不一致".into());
    }
    let url = validate_signed_url(&url)?;
    if !url
        .query_pairs()
        .any(|(key, _)| key.eq_ignore_ascii_case("X-Amz-Signature"))
    {
        return Err("缺少存储上传签名".into());
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let mut file = file;
    file.seek(SeekFrom::Start(offset))
        .await
        .map_err(|e| e.to_string())?;
    let body = reqwest::Body::wrap_stream(report_stream(file.take(length), length, on_progress));
    let mut request = state
        .client
        .put(url)
        .header("Content-Length", length)
        .body(body);
    for (key, value) in headers {
        request = request.header(key, value);
    }
    let token = state.abort_token(&task_id)?;
    let response = tokio::select! { _ = token.cancelled() => return Err("传输已暂停".into()), result = request.send() => result.map_err(|e| e.to_string())? };
    if !response.status().is_success() {
        return Err(format!("对象存储返回 HTTP {}", response.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn transfer_send_post(
    state: State<'_, TransferState>,
    task_id: String,
    source_id: String,
    url: String,
    fields: HashMap<String, String>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let path = state.path(&source_id, "source")?;
    let url = validate_signed_url(&url)?;
    if !fields
        .keys()
        .any(|key| key.eq_ignore_ascii_case("x-amz-signature"))
    {
        return Err("缺少存储上传签名".into());
    }
    let (size, _) = source_metadata(&path)?;
    let filename = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unnamed".into());
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::stream_with_length(
        reqwest::Body::wrap_stream(report_stream(file, size, on_progress)),
        size,
    )
    .file_name(filename);
    let mut form = reqwest::multipart::Form::new();
    for (key, value) in fields {
        form = form.text(key, value);
    }
    form = form.part("file", part);
    let token = state.abort_token(&task_id)?;
    let response = tokio::select! { _ = token.cancelled() => return Err("传输已暂停".into()), result = state.client.post(url).multipart(form).send() => result.map_err(|e| e.to_string())? };
    if !response.status().is_success() {
        return Err(format!("对象存储返回 HTTP {}", response.status()));
    }
    Ok(())
}

fn partial_path(target: &Path, id: &str) -> Result<PathBuf, String> {
    let parent = target.parent().ok_or("保存位置无效")?;
    Ok(parent.join(format!(".stagepilot-{id}.part")))
}

fn validate_download_response(
    status: reqwest::StatusCode,
    headers: &reqwest::header::HeaderMap,
    offset: u64,
    expected_size: u64,
    expected_etag: &str,
) -> Result<(), String> {
    if offset > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err("存储端未按断点返回数据，已停止以避免损坏文件".into());
    }
    if offset == 0
        && status != reqwest::StatusCode::PARTIAL_CONTENT
        && status != reqwest::StatusCode::OK
    {
        return Err(format!("对象存储返回 HTTP {status}"));
    }
    if !expected_etag.is_empty() {
        let etag = headers
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .trim_matches('"');
        if etag != expected_etag.trim_matches('"') {
            return Err("下载对象版本已变化".into());
        }
    }
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let range = headers
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let expected = format!("bytes {offset}-{}/{expected_size}", expected_size - 1);
        if range != expected {
            return Err("下载分段范围与预期不符".into());
        }
    }
    if let Some(length) = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
    {
        if length.parse::<u64>().ok() != Some(expected_size - offset) {
            return Err("下载响应长度与预期不符".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn transfer_download_range(
    state: State<'_, TransferState>,
    task_id: String,
    destination_id: String,
    url: String,
    expected_size: u64,
    expected_etag: String,
    on_progress: Channel<Progress>,
) -> Result<u64, String> {
    if expected_size == 0 || expected_size > MAX_FILE_BYTES {
        return Err("下载大小无效".into());
    }
    let destination = state.path(&destination_id, "destination")?;
    let partial = partial_path(&destination, &destination_id)?;
    let offset = match tokio::fs::metadata(&partial).await {
        Ok(meta) => meta.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.to_string()),
    };
    if offset > expected_size {
        return Err("本地临时文件比服务器版本更大".into());
    }
    if offset == expected_size {
        return Ok(offset);
    }
    let url = validate_signed_url(&url)?;
    if !url
        .query_pairs()
        .any(|(key, _)| key.eq_ignore_ascii_case("X-Amz-Signature"))
    {
        return Err("缺少存储下载签名".into());
    }
    let token = state.abort_token(&task_id)?;
    let response = tokio::select! { _ = token.cancelled() => return Err("传输已暂停".into()), result = state.client.get(url).header("Range", format!("bytes={offset}-")).send() => result.map_err(|e| e.to_string())? };
    validate_download_response(
        response.status(),
        response.headers(),
        offset,
        expected_size,
        &expected_etag,
    )?;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .open(&partial)
        .await
        .map_err(|e| e.to_string())?;
    file.set_len(offset).await.map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut received = offset;
    while let Some(chunk) = tokio::select! { _ = token.cancelled() => return Err("传输已暂停".into()), result = stream.next() => result }
    {
        let bytes = chunk.map_err(|e| e.to_string())?;
        received = received
            .checked_add(bytes.len() as u64)
            .ok_or("下载大小溢出")?;
        if received > expected_size {
            return Err("下载内容超过预期大小".into());
        }
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        let _ = on_progress.send(Progress {
            bytes: received,
            total: expected_size,
        });
    }
    file.sync_all().await.map_err(|e| e.to_string())?;
    if received != expected_size {
        return Err("下载中断，可稍后继续".into());
    }
    Ok(received)
}

#[tauri::command]
pub async fn transfer_finalize_download(
    state: State<'_, TransferState>,
    task_id: String,
    destination_id: String,
    expected_size: u64,
    expected_sha256: String,
) -> Result<(), String> {
    let destination = state.path(&destination_id, "destination")?;
    let partial = partial_path(&destination, &destination_id)?;
    let token = state.abort_token(&task_id)?;
    task::spawn_blocking(move || {
        if token.is_cancelled() {
            return Err("传输已暂停".into());
        }
        let mut file = std::fs::File::open(&partial).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() != expected_size {
            return Err("下载内容尚未完整".into());
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 1024 * 1024];
        loop {
            if token.is_cancelled() {
                return Err("传输已暂停".into());
            };
            let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        if expected_sha256.is_empty()
            || format!("{:x}", hash.finalize()) != expected_sha256.to_lowercase()
        {
            return Err("下载内容 SHA-256 校验失败".into());
        }
        if destination.exists() {
            return Err("目标文件已存在，请另选保存位置".into());
        }
        if token.is_cancelled() {
            return Err("传输已暂停".into());
        }
        std::fs::hard_link(&partial, &destination).map_err(|e| e.to_string())?;
        std::fs::remove_file(partial).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn transfer_delete_partial(
    state: State<'_, TransferState>,
    destination_id: String,
) -> Result<(), String> {
    let destination = state.path(&destination_id, "destination")?;
    let partial = partial_path(&destination, &destination_id)?;
    match tokio::fs::remove_file(partial).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue, CONTENT_LENGTH, CONTENT_RANGE, ETAG};

    #[test]
    fn signed_url_requires_tls_except_loopback() {
        assert!(
            validate_signed_url("https://storage.example.test/object?X-Amz-Signature=x").is_ok()
        );
        assert!(validate_signed_url("http://127.0.0.1:9000/object").is_ok());
        assert!(validate_signed_url("http://storage.example.test/object").is_err());
        assert!(validate_signed_url("file:///tmp/object").is_err());
        assert!(validate_signed_url("https://user:secret@storage.example.test/object").is_err());
    }

    #[test]
    fn resume_requires_exact_range_and_etag() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_RANGE, HeaderValue::from_static("bytes 5-9/10"));
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("5"));
        headers.insert(ETAG, HeaderValue::from_static("\"original\""));
        assert!(validate_download_response(
            reqwest::StatusCode::PARTIAL_CONTENT,
            &headers,
            5,
            10,
            "original"
        )
        .is_ok());
        assert!(
            validate_download_response(reqwest::StatusCode::OK, &headers, 5, 10, "original")
                .is_err()
        );
        assert!(validate_download_response(
            reqwest::StatusCode::PARTIAL_CONTENT,
            &headers,
            4,
            10,
            "original"
        )
        .is_err());
        assert!(validate_download_response(
            reqwest::StatusCode::PARTIAL_CONTENT,
            &headers,
            5,
            10,
            "changed"
        )
        .is_err());
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("4"));
        assert!(validate_download_response(
            reqwest::StatusCode::PARTIAL_CONTENT,
            &headers,
            5,
            10,
            "original"
        )
        .is_err());
    }

    #[test]
    fn first_download_can_accept_full_object() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("10"));
        assert!(validate_download_response(reqwest::StatusCode::OK, &headers, 0, 10, "").is_ok());
        assert!(validate_download_response(reqwest::StatusCode::OK, &headers, 1, 10, "").is_err());
    }
}
