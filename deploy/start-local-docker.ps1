param([switch]$SeedDemo)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath $docker)) { throw 'Docker Desktop is not installed.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env.production'))) {
    throw 'Missing deploy/.env.production.'
}

Push-Location $projectRoot
try {
    & $docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and wait for the engine to be ready.' }
    & npm.cmd run build -w '@wukong-math/admin'
    if ($LASTEXITCODE -ne 0) { throw 'Admin build failed.' }
    $compose = @('compose', '--env-file', 'deploy/.env.production', '-f', 'docker-compose.yml', '-f', 'compose.local.yml')
    & $docker @compose up -d --build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Service startup failed; check Docker compose logs.' }
    if ($SeedDemo) {
        Write-Warning 'Demo import replaces existing learning, content and account data.'
        & $docker @compose exec -T api npm run db:seed
        if ($LASTEXITCODE -ne 0) { throw 'Demo initialization failed.' }
    }
    & $docker @compose ps
    Write-Host 'Student: http://localhost:8080/'
    Write-Host 'Admin:   http://localhost:8080/admin/'
    Write-Host 'Health:  http://localhost:8080/api/health'
} finally {
    Pop-Location
}
