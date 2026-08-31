param([ValidateSet('unit','types','guards','build','e2e','api','web')][string]$Action)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if (-not $taskRoot.StartsWith('D:\CodexWorktrees\wave1-subscription-acceptance')) { throw 'Run only in the assigned D worktree.' }
Set-Location -LiteralPath $taskRoot
$taskOutput = Join-Path $taskRoot 'tmp/coordination/subscription-acceptance'
New-Item -ItemType Directory -Force -Path $taskOutput, "$taskOutput/temp", "$taskOutput/cache", "$taskOutput/logs", "$taskOutput/browser" | Out-Null
$env:TEMP = "$taskOutput/temp"; $env:TMP = $env:TEMP
$env:npm_config_cache = "$taskOutput/cache"; $env:XDG_CACHE_HOME = "$taskOutput/cache"
$env:GOMAXPROCS = '2'; $env:GOMEMLIMIT = '1536MiB'; $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$nodePath = 'C:\Users\motas\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:PATH = "$nodePath;$env:PATH"
function Invoke-Check([string]$name, [string[]]$arguments) {
  Set-Content -LiteralPath "$taskOutput/logs/$name.log" -Value "Command: node $($arguments -join ' ')" -Encoding utf8
  & "$nodePath/node.exe" @arguments 2>&1 | Tee-Object -Append -FilePath "$taskOutput/logs/$name.log"
  Add-Content -LiteralPath "$taskOutput/logs/$name.log" -Value "Exit code: $LASTEXITCODE" -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "$name failed with $LASTEXITCODE" }
}
switch ($Action) {
  unit { Invoke-Check 'unit' @('node_modules/vitest/vitest.mjs','run','--config','tests/subscription-discovery/wave1/vitest.config.mjs','--configLoader','runner','--maxWorkers=1','--no-file-parallelism') }
  types {
    Invoke-Check 'web-types' @('node_modules/typescript/bin/tsc','-p','apps/web/tsconfig.json','--noEmit','--pretty','false')
    Invoke-Check 'e2e-types' @('node_modules/typescript/bin/tsc','-p','tsconfig.subscription-discovery.json','--pretty','false')
  }
  guards {
    Invoke-Check 'i18n' @('scripts/check-web-i18n.mjs')
    Invoke-Check 'ui' @('scripts/check-web-ui.mjs')
    Invoke-Check 'contracts' @('scripts/generate-openapi-guards.mjs','--check')
    Invoke-Check 'api-guards' @('node_modules/vitest/vitest.mjs','run','--config','tests/subscription-discovery/wave1/api-guards.config.mjs','--configLoader','runner','--maxWorkers=1','--no-file-parallelism')
  }
  build { Invoke-Check 'build' @('node_modules/vite/bin/vite.js','build','--config','tests/subscription-discovery/wave1/vite.config.mjs','--configLoader','native') }
  e2e { Invoke-Check 'e2e' @('node_modules/@playwright/test/cli.js','test','--config','tests/subscription-discovery/wave1/playwright.config.ts','--workers=1') }
  api { & "$nodePath/node.exe" 'tests/subscription-discovery/wave1/server.mjs' }
  web { & "$nodePath/node.exe" 'node_modules/vite/bin/vite.js' '--config' 'tests/subscription-discovery/wave1/vite.config.mjs' '--configLoader' 'native' }
}
