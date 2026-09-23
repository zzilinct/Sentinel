; Remove only Sentinel's own files.
;
; The default removes the whole install folder. Someone who installs into a
; folder that holds other things (on one computer, D:\apps\Sentinel, which was
; also a source checkout) loses all of it. Only the files Sentinel ships are
; removed here, and the folder itself only if nothing else is left in it.
!macro customRemoveFiles
  Delete "$INSTDIR\Sentinel.exe"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir "$INSTDIR"
!macroend
