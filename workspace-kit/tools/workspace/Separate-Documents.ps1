$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destinationRoot = Join-Path $root 'business-documents'
$moves = @(
    @{ name='العرض الفني والمالي - منصة جوار المالية.docx'; area='proposals' },
    @{ name='تقرير مبادرة تطوير نظام مالي مؤسسي.docx'; area='reports' },
    @{ name='تقرير مبادرة تطوير نظام مالي مؤسسي.pdf'; area='reports' },
    @{ name='عرض مالي مرن - نظام جوار ERP - 2026.docx'; area='proposals' },
    @{ name='مبادرة تطوير منصة مالية مؤسسية.docx'; area='reports' },
    @{ name='financial-platform-audit-agent-kit.zip'; area='reference' },
    @{ name='.render_offer_a11y.json'; area='render-history' },
    @{ name='.render_offer'; area='render-history' },
    @{ name='.render_offer_word'; area='render-history' }
)
$manifest = foreach ($move in $moves) {
    $source = [IO.Path]::GetFullPath((Join-Path $root $move.name))
    $destination = [IO.Path]::GetFullPath((Join-Path $destinationRoot ($move.area + '/' + $move.name)))
    if (-not $source.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($destinationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe path' }
    if (-not (Test-Path -LiteralPath $source)) { throw "Source missing: $source" }
    if (Test-Path -LiteralPath $destination) { throw "Destination exists: $destination" }
    $item = Get-Item -LiteralPath $source -Force
    $files = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $source -File -Force -Recurse) } else { @($item) }
    $hashes = @(foreach ($file in $files) { [pscustomobject]@{ relative=if ($item.PSIsContainer) { [IO.Path]::GetRelativePath($source,$file.FullName) } else { '' }; hash=(Get-FileHash -LiteralPath $file.FullName).Hash } })
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Move-Item -LiteralPath $source -Destination $destination
    foreach ($hash in $hashes) {
        $file = if ($hash.relative) { Join-Path $destination $hash.relative } else { $destination }
        if ((Get-FileHash -LiteralPath $file).Hash -ne $hash.hash) { throw "Hash mismatch: $file" }
    }
    [pscustomobject]@{ source=$source; destination=$destination; files=$hashes }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $destinationRoot 'move-manifest.json') -Encoding utf8
Write-Host "Separated $($manifest.Count) document items; all file hashes verified. No deletions."
