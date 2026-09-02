$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$all = @(Get-CimInstance Win32_Process)
$ids = [System.Collections.Generic.HashSet[int]]::new()

foreach ($process in $all) {
  $commandLine = [string]$process.CommandLine
  $executablePath = [string]$process.ExecutablePath
  if (($commandLine -like "*$workspaceRoot*") -or ($executablePath -like "$workspaceRoot\*")) {
    if ($process.Name -notin @("pwsh.exe", "powershell.exe")) { [void]$ids.Add([int]$process.ProcessId) }
  }
}

$changed = $true
while ($changed) {
  $changed = $false
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $changed = $true }
  }
}

foreach ($id in @($ids)) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

Write-Output "Stopped $($ids.Count) StagePilot development process(es)."
