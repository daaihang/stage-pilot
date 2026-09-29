package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	ErrObjectNotFound    = errors.New("object not found")
	ErrMultipartNotFound = errors.New("multipart upload not found")
)

type MinIOConfig struct {
	Endpoint       string
	PublicEndpoint string
	AccessKey      string
	SecretKey      string
	Region         string
	Secure         bool
	PathStyle      bool
}

type MinIO struct {
	client        *minio.Client
	presignClient *minio.Client
	region        string
}

var _ Client = (*MinIO)(nil)

func NewMinIO(cfg MinIOConfig) (*MinIO, error) {
	endpoint := strings.TrimPrefix(strings.TrimPrefix(cfg.Endpoint, "http://"), "https://")
	if endpoint == "" {
		return nil, errors.New("storage endpoint is not configured")
	}
	region := cfg.Region
	if region == "" {
		region = "us-east-1"
	}
	lookup := minio.BucketLookupAuto
	if cfg.PathStyle {
		lookup = minio.BucketLookupPath
	}
	creds := credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, "")
	client, err := minio.New(endpoint, &minio.Options{Creds: creds, Secure: cfg.Secure, Region: region, BucketLookup: lookup})
	if err != nil {
		return nil, err
	}
	publicEndpoint := cfg.PublicEndpoint
	if publicEndpoint == "" {
		scheme := "http://"
		if cfg.Secure {
			scheme = "https://"
		}
		publicEndpoint = scheme + endpoint
	}
	publicURL, err := url.Parse(publicEndpoint)
	if err != nil || publicURL.Host == "" {
		return nil, errors.New("invalid public storage endpoint")
	}
	presignClient, err := minio.New(publicURL.Host, &minio.Options{
		Creds: creds, Secure: publicURL.Scheme == "https", Region: region, BucketLookup: lookup,
	})
	if err != nil {
		return nil, err
	}
	return &MinIO{client: client, presignClient: presignClient, region: region}, nil
}

func (m *MinIO) EnsureBucket(ctx context.Context, bucket, region string) error {
	if region == "" {
		region = m.region
	}
	err := m.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: region})
	if err == nil {
		return nil
	}
	if minio.ToErrorResponse(err).Code == "BucketAlreadyOwnedByYou" {
		return nil
	}
	return mapError(err)
}

func (m *MinIO) BucketVersioningStatus(ctx context.Context, bucket string) (string, error) {
	versioning, err := m.client.GetBucketVersioning(ctx, bucket)
	return versioning.Status, mapError(err)
}

func (m *MinIO) PresignPut(ctx context.Context, ref ObjectRef, ttl time.Duration) (PresignedRequest, error) {
	u, err := m.presignClient.PresignedPutObject(ctx, ref.Bucket, ref.Key, ttl)
	return PresignedRequest{URL: u, Method: http.MethodPut}, mapError(err)
}

func (m *MinIO) PresignPost(ctx context.Context, ref ObjectRef, contentType string, minBytes, maxBytes int64, ttl time.Duration) (PresignedRequest, error) {
	policy := minio.NewPostPolicy()
	if err := policy.SetBucket(ref.Bucket); err != nil {
		return PresignedRequest{}, err
	}
	if err := policy.SetKey(ref.Key); err != nil {
		return PresignedRequest{}, err
	}
	if err := policy.SetExpires(time.Now().Add(ttl)); err != nil {
		return PresignedRequest{}, err
	}
	if err := policy.SetContentLengthRange(minBytes, maxBytes); err != nil {
		return PresignedRequest{}, err
	}
	if contentType != "" {
		if err := policy.SetContentType(contentType); err != nil {
			return PresignedRequest{}, err
		}
	}
	u, fields, err := m.presignClient.PresignedPostPolicy(ctx, policy)
	return PresignedRequest{URL: u, Fields: fields, Method: http.MethodPost}, mapError(err)
}

func (m *MinIO) PresignGet(ctx context.Context, ref ObjectRef, ttl time.Duration, query map[string]string) (PresignedRequest, error) {
	values := make(url.Values, len(query))
	for key, value := range query {
		values.Set(key, value)
	}
	u, err := m.presignClient.PresignedGetObject(ctx, ref.Bucket, ref.Key, ttl, values)
	return PresignedRequest{URL: u, Method: http.MethodGet}, mapError(err)
}

func (m *MinIO) PresignPart(ctx context.Context, ref ObjectRef, uploadID string, spec UploadPartSpec, ttl time.Duration) (PresignedRequest, error) {
	query := url.Values{"uploadId": []string{uploadID}, "partNumber": []string{strconv.Itoa(spec.PartNumber)}}
	headers := http.Header{"Content-Length": []string{strconv.FormatInt(spec.Size, 10)}}
	if spec.ChecksumSHA256 != "" {
		headers.Set("X-Amz-Checksum-Sha256", spec.ChecksumSHA256)
	}
	u, err := m.presignClient.PresignHeader(ctx, http.MethodPut, ref.Bucket, ref.Key, ttl, query, headers)
	resultHeaders := map[string]string{"Content-Length": strconv.FormatInt(spec.Size, 10)}
	if spec.ChecksumSHA256 != "" {
		resultHeaders["x-amz-checksum-sha256"] = spec.ChecksumSHA256
	}
	return PresignedRequest{URL: u, Method: http.MethodPut, Headers: resultHeaders}, mapError(err)
}

func (m *MinIO) BeginMultipart(ctx context.Context, ref ObjectRef) (string, error) {
	id, err := (minio.Core{Client: m.client}).NewMultipartUpload(ctx, ref.Bucket, ref.Key, minio.PutObjectOptions{Checksum: minio.ChecksumSHA256})
	return id, mapError(err)
}

func (m *MinIO) ListParts(ctx context.Context, ref ObjectRef, uploadID string, marker, limit int) (PartsPage, error) {
	page, err := (minio.Core{Client: m.client}).ListObjectParts(ctx, ref.Bucket, ref.Key, uploadID, marker, limit)
	result := PartsPage{NextPartNumberMarker: page.NextPartNumberMarker, IsTruncated: page.IsTruncated}
	for _, part := range page.ObjectParts {
		result.Parts = append(result.Parts, ObjectPart{PartNumber: part.PartNumber, Size: part.Size, ETag: part.ETag, ChecksumSHA256: part.ChecksumSHA256})
	}
	return result, mapError(err)
}

func (m *MinIO) CompleteMultipart(ctx context.Context, ref ObjectRef, uploadID string, parts []CompletedPart) (ObjectInfo, error) {
	complete := make([]minio.CompletePart, 0, len(parts))
	for _, part := range parts {
		complete = append(complete, minio.CompletePart{PartNumber: part.PartNumber, ETag: part.ETag, ChecksumSHA256: part.ChecksumSHA256})
	}
	info, err := (minio.Core{Client: m.client}).CompleteMultipartUpload(ctx, ref.Bucket, ref.Key, uploadID, complete, minio.PutObjectOptions{})
	return ObjectInfo{Key: ref.Key, ETag: info.ETag, Size: info.Size}, mapError(err)
}

func (m *MinIO) AbortMultipart(ctx context.Context, ref ObjectRef, uploadID string) error {
	return mapError((minio.Core{Client: m.client}).AbortMultipartUpload(ctx, ref.Bucket, ref.Key, uploadID))
}

func (m *MinIO) StatObject(ctx context.Context, ref ObjectRef) (ObjectInfo, error) {
	info, err := m.client.StatObject(ctx, ref.Bucket, ref.Key, minio.StatObjectOptions{})
	return ObjectInfo{Key: ref.Key, Size: info.Size, ETag: strings.Trim(info.ETag, `"`), ContentType: info.ContentType}, mapError(err)
}

func (m *MinIO) OpenObject(ctx context.Context, ref ObjectRef) (io.ReadCloser, error) {
	return m.openObject(ctx, ref, nil)
}

func (m *MinIO) OpenObjectRange(ctx context.Context, ref ObjectRef, byteRange ObjectRange) (io.ReadCloser, error) {
	if byteRange.Start < 0 || byteRange.End < byteRange.Start {
		return nil, errors.New("invalid object byte range")
	}
	return m.openObject(ctx, ref, &byteRange)
}

func (m *MinIO) openObject(ctx context.Context, ref ObjectRef, byteRange *ObjectRange) (io.ReadCloser, error) {
	options := minio.GetObjectOptions{}
	if byteRange != nil {
		if err := options.SetRange(byteRange.Start, byteRange.End); err != nil {
			return nil, err
		}
	}
	object, err := m.client.GetObject(ctx, ref.Bucket, ref.Key, options)
	if err != nil {
		return nil, mapError(err)
	}
	if _, err := object.Stat(); err != nil {
		object.Close()
		return nil, mapError(err)
	}
	return object, nil
}

func (m *MinIO) PutObject(ctx context.Context, ref ObjectRef, reader io.Reader, size int64, contentType string) (ObjectInfo, error) {
	info, err := m.client.PutObject(ctx, ref.Bucket, ref.Key, reader, size, minio.PutObjectOptions{ContentType: contentType})
	return ObjectInfo{Key: ref.Key, Size: info.Size, ETag: strings.Trim(info.ETag, `"`), ContentType: contentType}, mapError(err)
}

func (m *MinIO) CopyObject(ctx context.Context, source, destination ObjectRef, matchETag string, size int64) (ObjectInfo, error) {
	src := minio.CopySrcOptions{Bucket: source.Bucket, Object: source.Key, MatchETag: matchETag}
	dst := minio.CopyDestOptions{Bucket: destination.Bucket, Object: destination.Key}
	var info minio.UploadInfo
	var err error
	if size <= 5_000_000_000 {
		info, err = m.client.CopyObject(ctx, dst, src)
	} else {
		parts := make([]minio.CopySrcOptions, 0, int(size/(1<<30))+1)
		for start := int64(0); start < size; start += 1 << 30 {
			end := min(start+(1<<30)-1, size-1)
			part := src
			part.MatchRange, part.Start, part.End = true, start, end
			parts = append(parts, part)
		}
		info, err = m.client.ComposeObject(ctx, dst, parts...)
	}
	if err != nil {
		return ObjectInfo{}, mapError(err)
	}
	stat, err := m.StatObject(ctx, destination)
	if err != nil || stat.Size != size {
		_ = m.RemoveObject(ctx, destination)
		if err != nil {
			return ObjectInfo{}, err
		}
		return ObjectInfo{}, fmt.Errorf("copied object size mismatch: expected %d, got %d", size, stat.Size)
	}
	if stat.ETag == "" {
		stat.ETag = strings.Trim(info.ETag, `"`)
	}
	return stat, nil
}

func (m *MinIO) RemoveObject(ctx context.Context, ref ObjectRef) error {
	return mapError(m.client.RemoveObject(ctx, ref.Bucket, ref.Key, minio.RemoveObjectOptions{}))
}

func (m *MinIO) WalkObjects(ctx context.Context, bucket, prefix string, visit func(ObjectInfo) error) error {
	for result := range m.client.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if result.Err != nil {
			return mapError(result.Err)
		}
		if err := visit(ObjectInfo{Key: result.Key, Size: result.Size, ETag: strings.Trim(result.ETag, `"`), ContentType: result.ContentType}); err != nil {
			return err
		}
	}
	return nil
}

func (m *MinIO) ListMultipartUploads(ctx context.Context, bucket, prefix, keyMarker, uploadMarker string, limit int) (MultipartUploadsPage, error) {
	page, err := (minio.Core{Client: m.client}).ListMultipartUploads(ctx, bucket, prefix, keyMarker, uploadMarker, "", limit)
	result := MultipartUploadsPage{NextKeyMarker: page.NextKeyMarker, NextUploadIDMarker: page.NextUploadIDMarker, IsTruncated: page.IsTruncated}
	for _, upload := range page.Uploads {
		result.Uploads = append(result.Uploads, MultipartUpload{Key: upload.Key, UploadID: upload.UploadID})
	}
	return result, mapError(err)
}

func mapError(err error) error {
	if err == nil {
		return nil
	}
	response := minio.ToErrorResponse(err)
	switch response.Code {
	case "NoSuchKey", "NoSuchObject", "NoSuchBucket", "NotFound":
		return fmt.Errorf("%w: %v", ErrObjectNotFound, err)
	case "NoSuchUpload":
		return fmt.Errorf("%w: %v", ErrMultipartNotFound, err)
	default:
		return err
	}
}
