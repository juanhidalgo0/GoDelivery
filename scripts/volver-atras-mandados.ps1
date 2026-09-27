# Vuelve atrás lo que se publicó con "lugares de mandados" (rama feature/rediseno-repartidor).
#
# Uso (desde la carpeta GoDelivery, en PowerShell):
#   .\scripts\volver-atras-mandados.ps1              -> vuelve la función que crea mandados y las reglas
#   .\scripts\volver-atras-mandados.ps1 -SoloFuncion -> vuelve solo la función (las reglas nuevas no molestan)
#
# Qué hace: toma firestore.rules y functions/index.js tal como estaban en la etiqueta
# "antes-de-mandados", los publica y deja tus archivos como estaban.
# La app de prueba (canal "mandados" de Hosting) no hace falta volverla atrás: es una dirección
# aparte que vence sola. Para borrarla antes: npx firebase hosting:channel:delete mandados --site godelivery-magdalena
# La app que usan los clientes nunca se tocó.
param([switch]$SoloFuncion)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

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
  $only = 'functions:default:createFavorOrder'
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
