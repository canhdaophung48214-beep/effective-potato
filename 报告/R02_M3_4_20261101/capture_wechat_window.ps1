Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M342Window{[StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,R,B;}[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);}'
$p=Get-Process | Where-Object {$_.MainWindowTitle -eq 'shishen-history-m342'} | Select-Object -First 1
if(!$p){throw 'PROJECT_WINDOW_NOT_FOUND'}
$r=New-Object M342Window+RECT
[M342Window]::GetWindowRect($p.MainWindowHandle,[ref]$r)|Out-Null
$b=[System.Drawing.Bitmap]::new(($r.R-$r.L),($r.B-$r.T))
$g=[System.Drawing.Graphics]::FromImage($b);$dc=$g.GetHdc();$ok=[M342Window]::PrintWindow($p.MainWindowHandle,$dc,2);$g.ReleaseHdc($dc);$b.Save((Join-Path (Get-Location) '报告/R02_M3_4_20261101/M342_evidence/wechat_actual_window.png'));$g.Dispose();$b.Dispose();Write-Output "PrintWindow=$ok"
