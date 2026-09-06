[CmdletBinding()]
param([ValidateSet('Inventory','Archive','Canonical','Verify')][string]$Action = 'Inventory')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$repo = Join-Path $root 'project'
$archive = Join-Path $root '_workspace_archive'
$inventoryPath = Join-Path $archive 'inventory-before.json'
$gitExecutable = (Get-Command git.exe -ErrorAction Stop).Source
function Git([string]$at, [string[]]$arguments) {
    $result = @(& $gitExecutable -C $at -c core.quotepath=false @arguments)
    if ($LASTEXITCODE -ne 0) { throw "Git failed ($LASTEXITCODE): $($arguments -join ' ')" }
    return $result
}
function SaveJson($value, [string]$path) {
    $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8
}
function AssertChild([string]$path, [string]$parent) {
    $full = [IO.Path]::GetFullPath($path).TrimEnd('\','/')
    $base = [IO.Path]::GetFullPath($parent).TrimEnd('\','/') + '\'
    if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe path: $path" }
    return $full
}
function GetWorktrees {
    $raw = (Git $repo @('worktree','list','--porcelain')) -join "`n"
    foreach ($block in ($raw -split "`n`n")) {
        if ($block -match '(?m)^worktree (.+)$') {
            $path = [IO.Path]::GetFullPath($Matches[1].Trim())
            $head = if ($block -match '(?m)^HEAD (.+)$') { $Matches[1].Trim() } else { '' }
            $branch = if ($block -match '(?m)^branch refs/heads/(.+)$') { $Matches[1].Trim() } else { '(detached)' }
            [pscustomobject]@{ path=$path; head=$head; branch=$branch; locked=($block -match '(?m)^locked(?: |$)') }
        }
    }
}
function GetLinks([string]$directory) {
    $queue = [Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($directory)
    while ($queue.Count) {
        $current = $queue.Dequeue()
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($current)) {
            if ([IO.Path]::GetFileName($entry) -eq '.git') { continue }
            $attributes = [IO.File]::GetAttributes($entry)
            if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
                $item = Get-Item -LiteralPath $entry -Force
                [pscustomobject]@{ path=$item.FullName; type=$item.LinkType; target=[string]$item.Target; directory=[bool]$item.PSIsContainer }
            } elseif ($attributes -band [IO.FileAttributes]::Directory) { $queue.Enqueue($entry) }
        }
    }
}
if ($Action -eq 'Inventory') {
    if (Test-Path -LiteralPath $inventoryPath) { throw 'Immutable inventory already exists; do not overwrite it.' }
    New-Item -ItemType Directory -Path $archive -Force | Out-Null
    $records = foreach ($wt in GetWorktrees) {
        if ($wt.path -eq $repo) { $destination = $wt.path }
        elseif ($wt.path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            $null = AssertChild $wt.path $root
            $destination = Join-Path $archive ('worktrees/' + (Split-Path $wt.path -Leaf))
        } else {
            $null = AssertChild $wt.path 'D:\CodexWorktrees'
            $destination = Join-Path 'D:\CodexWorktrees\_archive-juwar-20260906' (Split-Path $wt.path -Leaf)
        }
        $status = @(Git $wt.path @('status','--porcelain=v1','--untracked-files=all'))
        $common = (Git $wt.path @('rev-parse','--path-format=absolute','--git-common-dir')) -join ''
        $changed = @((Git $wt.path @('diff','--name-only','HEAD')); (Git $wt.path @('ls-files','--others','--exclude-standard'))) | Sort-Object -Unique
        $hashes = @(foreach ($rel in $changed) {
            $file = Join-Path $wt.path $rel
            if (Test-Path -LiteralPath $file -PathType Leaf) { [pscustomobject]@{ relative=$rel; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash } }
        })
        Write-Host "Inventory: $(Split-Path $wt.path -Leaf) ($($status.Count) changes)"
        [pscustomobject]@{ source=$wt.path; destination=$destination; head=$wt.head; branch=$wt.branch; commonDir=$common; status=$status; changedFiles=$hashes; links=@(GetLinks $wt.path) }
    }
    SaveJson ([pscustomobject]@{ createdAt=[DateTime]::UtcNow.ToString('o'); canonical=$repo; originMain=((Git $repo @('rev-parse','origin/main')) -join ''); worktrees=@($records) }) $inventoryPath
    Write-Host "Saved $(@($records).Count) worktrees. No source files changed."
    exit
}
$inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
function MapPath([string]$path) {
    foreach ($wt in $inventory.worktrees) {
        if ($path -eq $wt.source) { return $wt.destination }
        if ($path.StartsWith($wt.source + '\', [StringComparison]::OrdinalIgnoreCase)) { return $wt.destination + $path.Substring($wt.source.Length) }
    }
    return $path
}
if ($Action -eq 'Archive') {
    foreach ($wt in $inventory.worktrees) {
        if ($wt.source -eq $repo) { continue }
        $allowed = if ($wt.source.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { $root } else { 'D:\CodexWorktrees' }
        $null = AssertChild $wt.source $allowed
        $null = AssertChild $wt.destination $allowed
        if (-not (Test-Path -LiteralPath $wt.destination)) {
            $head = (Git $wt.source @('rev-parse','HEAD')) -join ''
            $status = @(Git $wt.source @('status','--porcelain=v1','--untracked-files=all'))
            if ($head -ne $wt.head -or ($status -join "`n") -cne ($wt.status -join "`n")) { throw "Work changed after inventory: $($wt.source)" }
            New-Item -ItemType Directory -Path (Split-Path $wt.destination -Parent) -Force | Out-Null
            Git $repo @('worktree','move',$wt.source,$wt.destination) | Out-Null
        } elseif (Test-Path -LiteralPath $wt.source) { throw "Both paths exist: $($wt.source)" }
        if (((Git $wt.destination @('rev-parse','HEAD')) -join '') -ne $wt.head) { throw 'HEAD mismatch after move' }
        if ((@(Git $wt.destination @('status','--porcelain=v1','--untracked-files=all')) -join "`n") -cne ($wt.status -join "`n")) { throw 'Status mismatch after move' }
        foreach ($entry in $wt.changedFiles) {
            if ((Get-FileHash -LiteralPath (Join-Path $wt.destination $entry.relative)).Hash -ne $entry.sha256) { throw 'File hash mismatch after move' }
        }
        Write-Host "Preserved: $(Split-Path $wt.destination -Leaf)"
    }
    # Retarget captured absolute links only. Never recurse through or delete a link target.
    foreach ($wt in $inventory.worktrees) {
        foreach ($link in $wt.links) {
            $path = MapPath $link.path
            $target = MapPath $link.target
            if ($target -eq $link.target) { continue }
            $null = AssertChild $path $wt.destination
            $item = Get-Item -LiteralPath $path -Force
            if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Not a link: $path" }
            if ([string]$item.Target -eq $target) { continue }
            if ([string]$item.Target -ne $link.target) { throw "Link unexpectedly changed: $path" }
            if ($link.directory) { [IO.Directory]::Delete($path) } else { [IO.File]::Delete($path) }
            New-Item -ItemType $link.type -Path $path -Target $target | Out-Null
        }
    }
    foreach ($wt in GetWorktrees) {
        if ($wt.path -eq $repo -or $wt.locked) { continue }
        if ($inventory.worktrees.destination -contains $wt.path) {
            Git $repo @('worktree','lock','--reason','Archived 2026-09-06; restore changes through a managed task',$wt.path) | Out-Null
        }
    }
    Write-Host 'Archives preserved and locked; absolute dependency links retargeted. Nothing deleted except replaced link objects.'
    exit
}
if ($Action -eq 'Canonical') {
    $first = $inventory.worktrees | Where-Object source -EQ $repo
    $before = (Git $repo @('rev-parse','HEAD')) -join ''
    if ($before -eq $inventory.originMain -and ((Git $repo @('branch','--show-current')) -join '') -eq 'main') { Write-Host 'Canonical already aligned.'; exit }
    if ($before -ne $first.head) { throw 'Canonical changed after inventory' }
    if (@($first.status | Where-Object { -not $_.StartsWith('?? ') }).Count) { throw 'Canonical has tracked changes; manual preservation required' }
    foreach ($entry in $first.changedFiles) {
        $source = Join-Path $repo $entry.relative
        $destination = Join-Path $archive ('uncommitted/project/' + $entry.relative)
        $null = AssertChild $source $repo
        $null = AssertChild $destination $archive
        if ((Get-FileHash -LiteralPath $source).Hash -ne $entry.sha256) { throw 'Canonical untracked file changed' }
        if (Test-Path -LiteralPath $destination) { throw 'Backup path already exists' }
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Move-Item -LiteralPath $source -Destination $destination
        if ((Get-FileHash -LiteralPath $destination).Hash -ne $entry.sha256) { throw 'Canonical preservation failed' }
    }
    Git $repo @('switch','main') | Out-Null
    Git $repo @('merge','--ff-only','origin/main') | Out-Null
    Write-Host 'Canonical project/main now fast-forwarded to origin/main. No push or deployment.'
    exit
}
if ($Action -eq 'Verify') {
    $registered = @(GetWorktrees)
    foreach ($wt in $inventory.worktrees) {
        if (-not ($registered.path -contains $wt.destination)) { throw "Missing registered worktree: $($wt.destination)" }
        $common = (Git $wt.destination @('rev-parse','--path-format=absolute','--git-common-dir')) -join ''
        if ($common -ne $wt.commonDir) { throw 'Common repository mismatch' }
        if ($wt.source -eq $repo) { continue }
        if (-not ($registered | Where-Object path -EQ $wt.destination).locked) { throw 'Archived worktree is not locked' }
        if (((Git $wt.destination @('rev-parse','HEAD')) -join '') -ne $wt.head) { throw 'Archived HEAD mismatch' }
        if ((@(Git $wt.destination @('status','--porcelain=v1','--untracked-files=all')) -join "`n") -cne ($wt.status -join "`n")) { throw 'Archived status mismatch' }
        foreach ($entry in $wt.changedFiles) {
            if ((Get-FileHash -LiteralPath (Join-Path $wt.destination $entry.relative)).Hash -ne $entry.sha256) { throw 'Archived hash mismatch' }
        }
    }
    foreach ($wt in $inventory.worktrees) {
        foreach ($link in $wt.links) {
            $actual = Get-Item -LiteralPath (MapPath $link.path) -Force
            if (-not ($actual.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected dependency link is missing' }
            if ([string]$actual.Target -ne (MapPath $link.target)) { throw 'Dependency link target mismatch' }
        }
    }
    if (((Git $repo @('branch','--show-current')) -join '') -ne 'main') { throw 'Canonical is not on main' }
    if (((Git $repo @('rev-parse','HEAD')) -join '') -ne ((Git $repo @('rev-parse','origin/main')) -join '')) { throw 'Canonical is not synchronized' }
    if (@(Git $repo @('status','--porcelain')).Count) { throw 'Canonical is dirty' }
    foreach ($entry in ($inventory.worktrees | Where-Object source -EQ $repo).changedFiles) {
        if ((Get-FileHash -LiteralPath (Join-Path $archive ('uncommitted/project/' + $entry.relative))).Hash -ne $entry.sha256) { throw 'Preserved canonical file mismatch' }
    }
    Write-Host "PASS: canonical main clean and synchronized; $($inventory.worktrees.Count - 1) archived worktrees and all uncommitted hashes intact."
}
