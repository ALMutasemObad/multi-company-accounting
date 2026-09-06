$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$archiveRoot = Join-Path $root '_workspace_archive/legacy-handoffs'
New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
$records = foreach ($name in @('HANDOFF_CURRENT','_ARCHIVE_NOT_FOR_HANDOFF')) {
    $source = [IO.Path]::GetFullPath((Join-Path $root $name))
    $destination = [IO.Path]::GetFullPath((Join-Path $archiveRoot $name))
    if (-not $source.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($archiveRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe path' }
    if (Test-Path -LiteralPath $destination) { throw 'Destination already exists' }
    $hashes = @(foreach ($file in Get-ChildItem -LiteralPath $source -Force -Recurse -File) { [pscustomobject]@{ relative=[IO.Path]::GetRelativePath($source,$file.FullName); hash=(Get-FileHash -LiteralPath $file.FullName).Hash } })
    Move-Item -LiteralPath $source -Destination $destination
    foreach ($hash in $hashes) { if ((Get-FileHash -LiteralPath (Join-Path $destination $hash.relative)).Hash -ne $hash.hash) { throw 'Hash verification failed' } }
    [pscustomobject]@{ source=$source; destination=$destination; files=$hashes }
}
$records | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $archiveRoot 'move-manifest.json') -Encoding utf8
$oldStatus = Join-Path $root '_workspace_archive/coordination-before.md'
if (Test-Path -LiteralPath $oldStatus) { throw 'Old status backup already exists' }
Copy-Item -LiteralPath (Join-Path $root 'COORDINATION_STATUS_AR.md') -Destination $oldStatus
Write-Host 'Historical handoffs archived with hashes; previous coordination report preserved.'
