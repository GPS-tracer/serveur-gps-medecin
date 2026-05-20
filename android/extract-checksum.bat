@echo off
REM ═══════════════════════════════════════════════════════════════════════════
REM  extract-checksum.bat
REM  Extrait le SHA-256 de la clé de signature et le convertit en Base64 URL-Safe
REM  Requis pour : PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM
REM
REM  Prérequis : Java JDK installé (keytool dans le PATH)
REM              Python 3 installé (pour la conversion Base64 URL-Safe)
REM
REM  Usage : Modifier KEYSTORE_PATH, KEY_ALIAS, STORE_PASS avant d'exécuter
REM ═══════════════════════════════════════════════════════════════════════════

SET KEYSTORE_PATH=app\keystore\release.jks
SET KEY_ALIAS=gpstracker
SET STORE_PASS=votre_mot_de_passe

echo.
echo ═══════════════════════════════════════════════════════
echo  ETAPE 1 : Extraction du certificat SHA-256 (keytool)
echo ═══════════════════════════════════════════════════════
echo.

keytool -list -v ^
  -keystore "%KEYSTORE_PATH%" ^
  -alias "%KEY_ALIAS%" ^
  -storepass "%STORE_PASS%" ^
  -keypass "%STORE_PASS%" ^
  | findstr /i "SHA256"

echo.
echo ═══════════════════════════════════════════════════════
echo  ETAPE 2 : Conversion en Base64 URL-Safe (Python)
echo  Copiez la valeur SHA256 ci-dessus (sans les ':')
echo  et remplacez SHA256_HEX_VALUE dans la commande suivante
echo ═══════════════════════════════════════════════════════
echo.
echo python -c "import base64, binascii; h='SHA256_HEX_VALUE_SANS_DEUX_POINTS'; print(base64.urlsafe_b64encode(binascii.unhexlify(h)).decode().rstrip('='))"
echo.
echo ═══════════════════════════════════════════════════════
echo  ETAPE 3 : Extraction directe depuis l'APK signé
echo  (methode alternative — plus fiable)
echo ═══════════════════════════════════════════════════════
echo.
echo apksigner verify --print-certs app\build\outputs\apk\release\app-release.apk
echo.
echo  Puis convertir le SHA-256 affiché avec la commande Python ci-dessus.
echo.
pause
