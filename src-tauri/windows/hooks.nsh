; Installer hooks (Tauri NSIS). See bundle.windows.nsis.installerHooks in tauri.conf.json.

; 0.1.x installed as "D4 Companion": remove that install first, so only Sanctuary Toolkit is left in the
; Start menu and in Installed apps. Its uninstaller runs silently, and silent mode never deletes app data:
; your settings, builds and loot history live under the app id both versions share (com.kenneth.d4companion).
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\D4 Companion" "UninstallString"
  ${If} $R0 != ""
    ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\D4 Companion" "InstallLocation"
    ; Tauri writes the location in quotes
    StrCpy $R2 $R1 1
    ${If} $R2 == '"'
      StrCpy $R1 $R1 -1 1
    ${EndIf}
    DetailPrint "Removing the old D4 Companion install"
    ${If} $R1 != ""
      ; _?= runs the uninstaller in place and waits for it (it can't delete itself, so that's done below)
      ExecWait '$R0 /S _?=$R1' $R3
      Delete "$R1\uninstall.exe"
      RMDir "$R1"
    ${Else}
      ExecWait '$R0 /S' $R3
    ${EndIf}
    ; an uninstaller that didn't run (missing files) leaves its entry: drop it so it doesn't linger in Installed apps
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\D4 Companion"
  ${EndIf}
!macroend
