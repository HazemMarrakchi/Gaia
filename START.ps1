# GAIA — Quick Start Scripts
# =========================
# Double-click or run: .\START.ps1

Write-Host "🌍 GAIA — The Living Planet Simulation" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
$checks = @(
    @{ Name = "Docker"; Cmd = "docker --version"; Url = "https://docker.com" },
    @{ Name = "Java 21"; Cmd = "java -version 2>&1 | Select-String '21'"; Url = "https://adoptium.net" },
    @{ Name = "Maven"; Cmd = "mvn -version"; Url = "https://maven.apache.org" },
    @{ Name = "Node.js"; Cmd = "node --version"; Url = "https://nodejs.org" },
    @{ Name = "Python"; Cmd = "python --version"; Url = "https://python.org" }
)

$missing = @()
foreach ($c in $checks) {
    try {
        $null = Invoke-Expression $c.Cmd
        Write-Host "✅ $($c.Name)" -ForegroundColor Green
    } catch {
        Write-Host "❌ $($c.Name) — install from $($c.Url)" -ForegroundColor Red
        $missing += $c.Name
    }
}

if ($missing) {
    Write-Host ""
    Write-Host "Missing: $($missing -join ', ')" -ForegroundColor Yellow
    Write-Host "Install them and re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Starting GAIA stack..." -ForegroundColor Cyan

# 1. Infrastructure
Write-Host ""
Write-Host "[1/5] Infrastructure (Kafka, PostGIS, Redis, Prometheus, Grafana, Flink)..." -ForegroundColor Yellow
docker compose up -d
Start-Sleep -Seconds 5

# 2. Build engine
Write-Host ""
Write-Host "[2/5] Building Java engine..." -ForegroundColor Yellow
Set-Location engine
mvn -q -DskipTests install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Maven build failed" -ForegroundColor Red
    exit 1
}
Set-Location ..

# 3. Start services
Write-Host ""
Write-Host "[3/5] Starting services..." -ForegroundColor Yellow

# AI service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd ai-service; pip install -q -r requirements.txt; uvicorn app.main:app --port 8091" -WindowStyle Minimized

# Ingestion service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "java -jar engine/ingestion-service/target/ingestion-service-0.1.0-SNAPSHOT.jar --server.port=8181" -WindowStyle Minimized

# Scenario service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "java -jar engine/scenario-service/target/scenario-service-0.1.0-SNAPSHOT.jar --server.port=8282" -WindowStyle Minimized

Start-Sleep -Seconds 10

# 4. Build frontends
Write-Host ""
Write-Host "[4/5] Building frontends..." -ForegroundColor Yellow

# World Brain
Set-Location frontend/world-brain
if (-not (Test-Path node_modules)) { npm install }
npm run build
Set-Location ../..

# Portal
Set-Location frontend/portal
if (-not (Test-Path node_modules)) { npm install }
npm run build
Set-Location ../..

# 5. Start frontends
Write-Host ""
Write-Host "[5/5] Starting frontends..." -ForegroundColor Yellow

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend/world-brain; npm start" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend/portal; npm run dev" -WindowStyle Minimized

Write-Host ""
Write-Host "🎉 GAIA is starting up!" -ForegroundColor Green
Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan
Write-Host "  • World Brain (3D Control Room):  http://localhost:4302" -ForegroundColor White
Write-Host "  • Public Portal:                 http://localhost:3000" -ForegroundColor White
Write-Host "  • Grafana Dashboard:             http://localhost:3001/d/gaia-live" -ForegroundColor White
Write-Host "  • Flink UI:                      http://localhost:8381" -ForegroundColor White
Write-Host "  • Prometheus:                    http://localhost:9090" -ForegroundColor White
Write-Host ""
Write-Host "APIs:" -ForegroundColor Cyan
Write-Host "  • Live Events:                   http://localhost:8181/events" -ForegroundColor White
Write-Host "  • Replay:                        http://localhost:8181/replay?fromTick=0&toTick=100" -ForegroundColor White
Write-Host "  • Health:                        http://localhost:8181/health/sim" -ForegroundColor White
Write-Host "  • What-if Scenarios:             POST http://localhost:8282/scenarios" -ForegroundColor White
Write-Host "  • AI Suggestions:                POST http://localhost:8091/scenario/suggest" -ForegroundColor White
Write-Host ""
Write-Host "Run smoke test:  sh scripts/smoke.sh" -ForegroundColor Yellow
Write-Host ""
