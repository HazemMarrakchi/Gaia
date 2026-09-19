# GAIA — Stop everything
Write-Host "Stopping GAIA..." -ForegroundColor Yellow

# Stop Docker containers
docker compose down

# Kill Java services (ingestion + scenario)
Get-Process | Where-Object { $_.ProcessName -match "java" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Kill Node dev servers (world-brain + portal)
Get-Process | Where-Object { $_.ProcessName -match "node" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Kill Python uvicorn
Get-Process | Where-Object { $_.ProcessName -match "python|uvicorn" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "✅ GAIA stopped" -ForegroundColor Green
