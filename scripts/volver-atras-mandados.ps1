# Vuelve atrás lo que se publicó con "lugares de mandados" (rama feature/rediseno-repartidor).
#
# Uso (desde la carpeta GoDelivery, en PowerShell):
#   .\scripts\volver-atras-mandados.ps1 -SoloApp     -> vuelve solo la app (clientes y repartidores). Lo más rápido.
#   .\scripts\volver-atras-mandados.ps1              -> vuelve la app, la función que crea mandados y las reglas
#   .\scripts\volver-atras-mandados.ps1 -SoloFuncion -> vuelve solo la función (las reglas nuevas no molestan)
#
# La app anterior quedó copiada en el canal "respaldo-antes-mandados" (vence el 27/10/2026); volver es
# copiarla otra vez a la dirección real. También se puede desde la consola de Firebase: Hosting >
# historial de versiones > Revertir.
# La función y las reglas vuelven a como estaban en la etiqueta "antes-de-mandados"; tus archivos quedan igual.
# -Copia: 'respaldo-antes-mapas' (27/09, antes de mapas propios y seguimiento nuevo) o 'respaldo-antes-mandados' (versión anterior)
param([switch]$SoloFuncion, [switch]$SoloApp, [string]$Copia = 'respaldo-antes-mapas')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not $SoloFuncion) {
  Write-Host 'Volviendo la app a la version anterior...' -ForegroundColor Yellow
  npx firebase hosting:clone "godelivery-magdalena:$Copia" godelivery-magdalena:live --project godelivery-magdalena
  if ($LASTEXITCODE -ne 0) { throw "No se pudo volver la app (codigo $LASTEXITCODE)" }
  Write-Host 'App: lista.' -ForegroundColor Green
  if ($SoloApp) { return }
}

$tag = 'antes-de-mandados'
git rev-parse --verify $tag | Out-Null

$files = @('functions/index.js')
if (-not $SoloFuncion) { $files += 'firestore.rules' }

# Copia de lo actual para dejarlo como estaba al final
$backup = Join-Path $env:TEMP "godelivery-antes-de-volver-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $backup | Out-Null
foreach ($f in $files) { Copy-Item $f (Join-Path $backup ($f -replace '/', '_')) }

try {
  foreach ($f in $files) { git checkout $tag -- $f }
  $only = 'functions:default:createFavorOrder,functions:default:onOrderStatusChange'
  if (-not $SoloFuncion) { $only += ',firestore:rules' }
  Write-Host "Publicando la version anterior de: $only" -ForegroundColor Yellow
  npx firebase deploy --only $only --project godelivery-magdalena
  if ($LASTEXITCODE -ne 0) { throw "El deploy fallo (codigo $LASTEXITCODE)" }
  Write-Host 'Listo: produccion volvio a como estaba antes de los mandados.' -ForegroundColor Green
}
finally {
  foreach ($f in $files) { Copy-Item (Join-Path $backup ($f -replace '/', '_')) $f -Force }
  git reset -q -- $files
  Write-Host "Tus archivos quedaron como estaban (copia en $backup)."
}
