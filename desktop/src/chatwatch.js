'use strict';
/**
 * Chat safety: Roblox and the Discord app, read on this computer, so a scam or someone grooming a child is pointed
 * out beside the message itself. Off until the person (or a parent) turns it on, and visibly on while it watches.
 *
 * Sentinel's helper (browsers.js) hears which window is in front, and only then does anything here wake. While no
 * watched app is in front the reader sleeps on its input, using nothing, and after ten minutes it is ended; the next
 * time one comes to the front it starts again. If it dies or stops answering it is brought back (3 s doubling up to 5
 * minutes, as the live reader is), and until it is, the page and the tray say chat is not being watched: a switch that
 * says on while nothing reads is the worst thing this file could do.
 *
 * What it reads, and only while the app is the window in front:
 *   Discord   the messages on screen, through the accessibility interface screen readers use (who wrote each one,
 *             what it says, where it is), and the window's title (the server and channel, or the person in a DM).
 *   Roblox    the chat box, by recognising its text with the recogniser built into Windows (the copy of that corner
 *             of the window is read in memory and dropped at once, and only when words in it changed); a thin band
 *             across the middle once a second, and the middle itself when that band jumps, for the words of the Esc
 *             menu; and Roblox's own log file for which game is being played. The game's name and
 *             description come from Roblox's public game pages, by its place number: they are what makes "where do
 *             you live" ordinary in a role-play town and not in a lobby.
 *   Phone Link  (its own switch, "Check my texts") the open conversation: who it is with and the messages received,
 *             through the accessibility interface, or with the text recogniser over the conversation side of the window
 *             when Windows cannot describe it. Judged by server/lib/scan/texts.js; links in a text are checked by
 *             address only, like a copied link, never opened, and never kept in history.
 * Nothing is read while chat is closed in a game, nothing is kept: each message is judged (server/lib/scan/chat.js,
 * loaded here directly, so not even this computer's own server sees it) and forgotten. No message, name or game is
 * written to the log, sent to Sentinel or anywhere else. Roblox is never touched: no code goes into it, nothing of
 * its memory is read, and no key or click is sent to it. The Sentinel badge shows in Roblox only away from a game or
 * when its Esc menu is open, and no gold line ever crosses a game.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { conversation } = require('../shared/chat');
const texts = require('../shared/texts');

/* ------------------------------------------------------------- the reader */

// A PowerShell loop: what the chat of the app in front shows. One JSON line per change. It is told which window that
// is ("front discord 1234", "front -"), and waits on its input for that: it never asks which window is in front, only
// checks, before each read, that the window it was told about still is. "alive" every few seconds while it reads, so a
// reader stuck inside Windows is noticed as surely as one that died.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  // The window's client area on screen: x, y, w, h.
  public static int[] Client(IntPtr h) { RECT r; GetClientRect(h, out r); var p = new POINT(); ClientToScreen(h, ref p); return new[] { p.X, p.Y, r.Right - r.Left, r.Bottom - r.Top }; }
  // How the last copy looked: all black (a game Windows will not hand over), and how bright, 0 to 765.
  public static bool Black; public static long Lum;
  // A part of the screen as BGRA bytes, and a fingerprint of its near-white pixels. Chat words are drawn in those (or
  // cut out of a white page), so a chat box that says the same thing over a moving game is not read again.
  public static byte[] Grab(int x, int y, int w, int h, out long print) {
    using (var bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
      using (var g = System.Drawing.Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h));
      var d = bmp.LockBits(new System.Drawing.Rectangle(0, 0, w, h), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      var bytes = new byte[d.Stride * h];
      Marshal.Copy(d.Scan0, bytes, 0, bytes.Length);
      bmp.UnlockBits(d);
      long p = 17, sum = 0; int top = 0;
      for (int i = 0; i + 2 < bytes.Length; i += 4) {
        int b = bytes[i], m = bytes[i + 1], c = bytes[i + 2];
        sum += b + m + c; top = Math.Max(top, b | m | c);
        if (b > 215 && m > 215 && c > 215) p = p * 31 + i;
      }
      print = p; Black = top < 8; Lum = sum / Math.Max(1, w * h);
      return bytes;
    }
  }
}
"@ -ReferencedAssemblies System.Drawing
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Wait-Op($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(-1); $t.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Output '{"error":"no text recogniser"}' }
# The text in a part of the screen: one entry per line, with where it is (screen pixels). Read in memory.
function Read-Area($x, $y, $w, $h) {
  if ($null -eq $engine -or $w -lt 40 -or $h -lt 20) { return $null }
  $print = 0
  $bytes = [CW]::Grab($x, $y, $w, $h, [ref]$print)
  $buf = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
  $sb = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buf, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, $w, $h)
  $res = Wait-Op ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $sb.Dispose(); $bytes = $null
  $lines = @()
  foreach ($l in $res.Lines) {
    $r = $null
    foreach ($wd in $l.Words) { $b = $wd.BoundingRect; if ($null -eq $r) { $r = @([int]$b.X, [int]$b.Y, [int]($b.X + $b.Width), [int]($b.Y + $b.Height)) } else { $r = @([Math]::Min($r[0], [int]$b.X), [Math]::Min($r[1], [int]$b.Y), [Math]::Max($r[2], [int]($b.X + $b.Width)), [Math]::Max($r[3], [int]($b.Y + $b.Height))) } }
    if ($r) { $lines += @{ t = $l.Text; x = $x + $r[0]; y = $y + $r[1]; w = $r[2] - $r[0]; h = $r[3] - $r[1] } }
  }
  return $lines
}
function Print($x, $y, $w, $h) { $p = 0; $null = [CW]::Grab($x, $y, $w, $h, [ref]$p); return $p }

$A = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$textCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $CT::Text)
$listCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $CT::List)
# Phone Link's parts, in one walk: lists, message boxes, and its Messages tab. (The conditions take an array.)
function Is($type) { New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $type) }
function AnyOf { New-Object System.Windows.Automation.OrCondition -ArgumentList (,[System.Windows.Automation.Condition[]]$args) }
function AllOf { New-Object System.Windows.Automation.AndCondition -ArgumentList (,[System.Windows.Automation.Condition[]]$args) }
$plCond = AnyOf $listCond (Is $CT::Edit) (AllOf (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'Messages')) (AnyOf (Is $CT::TabItem) (Is $CT::ListItem) (Is $CT::RadioButton)))
$cache = New-Object System.Windows.Automation.CacheRequest
$cache.Add($A::NameProperty); $cache.Add($A::BoundingRectangleProperty); $cache.Add($A::AutomationIdProperty); $cache.Add($A::LocalizedControlTypeProperty)
$itemCache = New-Object System.Windows.Automation.CacheRequest
$itemCache.Add($A::BoundingRectangleProperty); $itemCache.Add($A::AutomationIdProperty); $itemCache.Add($A::NameProperty)
# The launcher's reader (LAUNCH, below), over the raw input stream: Console.In's ReadLineAsync runs synchronously in
# Windows PowerShell, so the loop would stop at the first read until the app sent its next command.
$stdin = $in
$pending = $stdin.ReadLineAsync()
$lastApp = ''; $lastSig = ''; $lastPrint = 0; $chatOpen = $true; $nextMenu = 0; $lastMenu = $null; $menuLum = 0; $msgList = $null; $msgFor = [IntPtr]::Zero; $nextList = 0; $who = ''; $msgTab = $null; $whoKeys = @{}; $plSeen = 0
$app = ''; $h = [IntPtr]::Zero; $fp = 0; $wait = 700; $nextAlive = 0; $lastItems = ''; $nextFull = 0
$eye = @{ dark = 0; blind = $false }
Write-Output '{"ready":true}'
# Black again and again: Windows is keeping this window's picture from other programs. (Once could be a loading screen.)
function Seen-Black {
  if ([CW]::Black) { $eye.dark++ } else { $eye.dark = 0 }
  $now = $eye.dark -ge 4
  if ($now -ne $eye.blind) { $eye.blind = $now; Write-Output (@{ app = $app; blind = $now } | ConvertTo-Json -Compress) }
}
while ($true) {
  # Nothing in front to read: asleep here until the app says otherwise, using nothing.
  if ($pending.Wait($(if ($app) { $wait } else { -1 }))) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit }
    $pending = $stdin.ReadLineAsync()
    if ($cmd -eq 'chat closed') { $chatOpen = $false } elseif ($cmd -eq 'chat open') { $chatOpen = $true }
    elseif ($cmd -eq 'front -') { $app = ''; $h = [IntPtr]::Zero; $lastApp = ''; $lastSig = ''; $eye.dark = 0; $eye.blind = $false }
    elseif ($cmd -match '^front ([a-z]+) (\d{1,20})$') { $app = $Matches[1]; $h = [IntPtr][long]$Matches[2]; $fp = 0; [void][CW]::GetWindowThreadProcessId($h, [ref]$fp) }
    if (-not $app) { continue }
  }
  $wait = 700
  if ([Environment]::TickCount -gt $nextAlive) { $nextAlive = [Environment]::TickCount + 5000; Write-Output '{"alive":true}' }
  # Only the window in front: if it has just changed the app will say so, and nothing is read meanwhile.
  if ([CW]::GetForegroundWindow() -ne $h -or [CW]::IsIconic($h)) { continue }
  $c = [CW]::Client($h)
  if ($app -ne $lastApp) { $lastApp = $app; $lastSig = ''; $lastPrint = 0; $msgList = $null; $lastItems = '' }
  try {
    if ($app -eq 'discord') {
      # The message list ("Messages in #channel" / "Messages in @name"): found once per window, then reused, and looked
      # for at most every 3 seconds on a screen that has none: finding it walks the whole of Discord.
      if ($msgFor -ne $h -or (-not $msgList -and [Environment]::TickCount -gt $nextList)) {
        $msgList = $null; $msgFor = $h; $nextList = [Environment]::TickCount + 3000
        $lists = $A::FromHandle($h).FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCond)
        foreach ($l in $lists) { if ($l.Current.Name -like 'Messages in*') { $msgList = $l; break } }
      }
      if ($msgList) {
        $scope = $itemCache.Activate()
        try { $items = $msgList.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) } finally { $scope.Dispose() }
        $boxes = @(); $itemSig = ''
        foreach ($it in $items) {
          $b = $it.GetCachedPropertyValue($A::BoundingRectangleProperty)
          if ([double]::IsInfinity($b.Y) -or $b.Height -lt 8 -or $b.Bottom -lt $c[1] -or $b.Top -gt $c[1] + $c[3]) { continue }
          $boxes += ,@($it.GetCachedPropertyValue($A::AutomationIdProperty), $b)
          $itemSig += [string]$it.GetCachedPropertyValue($A::AutomationIdProperty) + '|' + [int]$b.Y + '|' + [int]$b.Height + '|' + ([string]$it.GetCachedPropertyValue($A::NameProperty)).Length + ';'
        }
        # Every word in the list is read only when a message on screen changed shape, or every few seconds for an edit
        # that did not: a chat left open costs one short look per tick.
        if ($itemSig -ne $lastItems -or [Environment]::TickCount -gt $nextFull) {
        $lastItems = $itemSig; $nextFull = [Environment]::TickCount + 3000
        $scope = $cache.Activate()
        try { $texts = $msgList.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond) } finally { $scope.Dispose() }
        $out = @(); $n = 0
        foreach ($bx in ($boxes | Select-Object -Last 30)) {
          $b = $bx[1]; $who = ''; $parts = @()
          foreach ($t in $texts) {
            $tb = $t.GetCachedPropertyValue($A::BoundingRectangleProperty)
            if ([double]::IsInfinity($tb.Y) -or $tb.Top -lt $b.Top - 1 -or $tb.Bottom -gt $b.Bottom + 1) { continue }
            $tn = [string]$t.GetCachedPropertyValue($A::NameProperty)
            if (-not $tn) { continue }
            if (-not $who -and [string]$t.GetCachedPropertyValue($A::LocalizedControlTypeProperty) -match 'heading') { $who = $tn; continue }
            $parts += $tn
          }
          $out += @{ k = [string]$bx[0]; who = $who; t = (($parts -join ' ') -replace '\s+', ' ').Trim(); x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height }
        }
        $sig = ($out | ForEach-Object { $_.k + '|' + $_.y + '|' + $_.t.Length }) -join ';'
        if ($sig -ne $lastSig) { $lastSig = $sig; Write-Output (@{ app = 'discord'; title = [CW]::Title($h); win = $c; items = $out } | ConvertTo-Json -Compress -Depth 4) }
        }
      } else {
        # No message list to read (Discord still building it, or a screen without one): said once, so the badge is honest.
        $msgList = $null
        if ($lastSig -ne 'nolist') { $lastSig = 'nolist'; Write-Output (@{ app = 'discord'; title = [CW]::Title($h); win = $c; items = @(); noList = $true } | ConvertTo-Json -Compress -Depth 4) }
      }
    } elseif ($app -eq 'phonelink') {
      # Phone Link: found once per window (and looked for again at most every 5 seconds while missing), in one walk:
      # the Messages tab, and the open conversation's message list. That is the list furthest right that is not the
      # list of conversations on the left edge, or, in a narrow window where the conversation fills it, the list with
      # the message box under it.
      if ((-not $msgList -or $msgFor -ne $h) -and ($msgFor -ne $h -or [Environment]::TickCount -gt $nextList)) {
        # A window just opened may not have described itself yet: looked at again every second for its first seconds.
        if ($msgFor -ne $h) { $plSeen = [Environment]::TickCount }
        $msgList = $null; $msgFor = $h; $nextList = [Environment]::TickCount + $(if ([Environment]::TickCount - $plSeen -lt 6000) { 1000 } else { 5000 }); $best = [double]::MinValue; $msgTab = $null; $whoKeys = @{}
        $found = $A::FromHandle($h).FindAll([System.Windows.Automation.TreeScope]::Descendants, $plCond)
        $lists = @(); $edits = @()
        foreach ($e in $found) {
          $ct = $e.Current.ControlType
          if ($ct -eq $CT::List) { $lists += $e } elseif ($ct -eq $CT::Edit) { $edits += $e.Current.BoundingRectangle }
          elseif (-not $msgTab -and $e.Current.Name -eq 'Messages') { try { $msgTab = $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) } catch { } }
        }
        foreach ($l in $lists) {
          $b = $l.Current.BoundingRectangle
          if ($b.Width -le 200 -or $b.Height -le 150) { continue }
          $box = @($edits | Where-Object { $_.Top -ge $b.Bottom - 40 -and $_.Top -le $b.Bottom + 200 -and ($_.X + $_.Width / 2) -gt $b.Left -and ($_.X + $_.Width / 2) -lt $b.Right }).Count -gt 0
          if (($b.X -ge $c[0] + $c[2] * 0.25 -or $box) -and $b.X -gt $best) { $best = $b.X; $msgList = $l }
        }
      }
      # Only the Messages tab is read: never calls, photos or notifications. (Without a tab Windows can describe, the
      # open conversation is what tells.)
      if ($msgTab -and -not $msgTab.Current.IsSelected) {
        if ($lastSig -ne 'notab') { $lastSig = 'notab'; $lastPrint = 0; Write-Output (@{ app = 'phonelink'; win = $c; items = @(); noTab = $true } | ConvertTo-Json -Compress -Depth 4) }
      } elseif ($msgList) {
        $lb = $msgList.Current.BoundingRectangle
        $scope = $itemCache.Activate()
        try { $items = $msgList.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) } finally { $scope.Dispose() }
        # The messages on screen, and a quick signature of them: their texts are read only when it changes, so a
        # conversation left open costs one short look per tick.
        $vis = @(); $sig = ''
        foreach ($it in $items) {
          $b = $it.GetCachedPropertyValue($A::BoundingRectangleProperty)
          if ([double]::IsInfinity($b.Y) -or $b.Height -lt 8 -or $b.Bottom -lt $c[1] -or $b.Top -gt $c[1] + $c[3]) { continue }
          $vis += $it
          $sig += [string]$it.GetCachedPropertyValue($A::AutomationIdProperty) + '|' + [int]$b.Y + '|' + [int]$b.Height + '|' + ([string]$it.GetCachedPropertyValue($A::NameProperty)).Length + ';'
        }
        if ($sig -ne $lastSig) {
          $lastSig = $sig
          $out = @()
          foreach ($it in ($vis | Select-Object -Last 30)) {
            $b = $it.GetCachedPropertyValue($A::BoundingRectangleProperty)
            $scope = $cache.Activate()
            try { $texts = $it.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond) } finally { $scope.Dispose() }
            $parts = @(); $left = [double]::MaxValue; $right = [double]::MinValue
            foreach ($t in $texts) {
              $tb = $t.GetCachedPropertyValue($A::BoundingRectangleProperty)
              if ([double]::IsInfinity($tb.Y)) { continue }
              $tn = [string]$t.GetCachedPropertyValue($A::NameProperty)
              if ($tn) { $parts += $tn; $left = [Math]::Min($left, $tb.Left); $right = [Math]::Max($right, $tb.Right) }
            }
            if (-not $parts.Count) { $parts = @([string]$it.GetCachedPropertyValue($A::NameProperty)); $left = $b.Left; $right = $b.Right }
            # Received texts lean on the left of the conversation, sent ones on the right: only received ones are judged.
            $out += @{ k = [string]$it.GetCachedPropertyValue($A::AutomationIdProperty); t = (($parts -join ' ') -replace '\s+', ' ').Trim(); rx = (($left - $lb.Left) -le ($lb.Right - $right)); x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height }
          }
          # A message whose words Windows has not described yet is read again on the next tick.
          if (@($out | Where-Object { -not $_.t }).Count) { $lastSig = '' }
          # Who the conversation is with: the top line of its header, just above the message list. Looked for only when
          # the conversation changed (none of these messages were on screen before), and only in the part of the window
          # around the conversation, not the whole window.
          $keys = @{}; foreach ($o in $out) { $keys[$o.k + '|' + $o.t] = 1 }
          $same = $false; foreach ($k in $keys.Keys) { if ($whoKeys.ContainsKey($k)) { $same = $true; break } }
          $whoKeys = $keys
          if (-not $same) {
            $who = ''; $whoY = [double]::MaxValue
            $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
            $around = $walker.GetParent($msgList); $up = 0
            # Never past Phone Link's own window: the desktop above it holds every other window.
            while ($around -and $up -lt 4 -and $around.Current.ProcessId -eq $fp -and $around.Current.BoundingRectangle.Top -gt $lb.Top - 30) { $around = $walker.GetParent($around); $up++ }
            if (-not $around -or $around.Current.ProcessId -ne $fp) { $around = $A::FromHandle($h) }
            $scope = $cache.Activate()
            try { $all = $around.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond) } finally { $scope.Dispose() }
            foreach ($t in $all) {
              $tb = $t.GetCachedPropertyValue($A::BoundingRectangleProperty)
              if ([double]::IsInfinity($tb.Y) -or $tb.Bottom -gt $lb.Top + 1 -or $tb.Top -lt $lb.Top - 140 -or $tb.X -lt $lb.X - 20) { continue }
              $tn = [string]$t.GetCachedPropertyValue($A::NameProperty)
              if ($tn -and $tb.Y -lt $whoY) { $who = $tn; $whoY = $tb.Y }
            }
          }
          Write-Output (@{ app = 'phonelink'; who = $who; win = $c; items = $out } | ConvertTo-Json -Compress -Depth 4)
        }
      } elseif ([Environment]::TickCount - $plSeen -gt 6000) {
        # No conversation list Windows can describe, even after a few seconds (reading it twice, both ways, would judge
        # each text twice): the conversation side of the window is read with the text recogniser instead, only when it
        # changed, as Roblox's chat box is. A narrow window shows the conversation alone, so all of it is read.
        $cut = if ($c[2] -lt 760) { 0 } else { [int]($c[2] * 0.3) }
        $px = $c[0] + $cut; $pw = $c[2] - $cut
        $p = Print $px $c[1] $pw $c[3]
        Seen-Black
        if ($eye.blind) { $lastPrint = 0 } elseif ($p -ne $lastPrint) {
          $lastPrint = $p; $lastSig = ''
          $lines = Read-Area $px $c[1] $pw $c[3]
          Write-Output (@{ app = 'phonelink'; win = $c; pane = @($px, $c[1], $pw, $c[3]); lines = @($lines); ocr = ($null -ne $engine) } | ConvertTo-Json -Compress -Depth 4)
        }
      }
    } else {
      # Roblox: the chat box sits in the top left of the window. It is read only when it changed, and less often
      # while chat is closed (the app says so: then only a glance for the box coming back).
      $cw = [int][Math]::Min(620, $c[2] * 0.45); $ch = [int][Math]::Min(460, $c[3] * 0.5)
      $p = Print $c[0] $c[1] $cw $ch
      Seen-Black
      if ($eye.blind) { $lastPrint = 0 } elseif ($p -ne $lastPrint) {
        $lastPrint = $p
        $lines = Read-Area $c[0] $c[1] $cw $ch
        Write-Output (@{ app = 'roblox'; win = $c; area = @($c[0], $c[1], $cw, $ch); lines = @($lines) } | ConvertTo-Json -Compress -Depth 4)
      }
      # The Esc menu dims the whole game. A thin band across the middle is looked at once a second, and the recogniser
      # (half the screen, the costliest thing here) runs only when that band jumps, or while the menu is open to see it go.
      if ([Environment]::TickCount -gt $nextMenu) {
        $nextMenu = [Environment]::TickCount + 1000
        $mx = $c[0] + [int]($c[2] * 0.25); $my = $c[1] + [int]($c[3] * 0.3); $mw = [int]($c[2] * 0.5); $mh = [int]($c[3] * 0.6)
        $null = Print $mx ($my + [int]($mh / 2)) $mw 8
        $lum = [CW]::Lum
        if ($lastMenu -ne $false -or [Math]::Abs($lum - $menuLum) -gt [Math]::Max(12, $menuLum / 5)) {
          $ml = Read-Area $mx $my $mw $mh
          $menu = [bool](@($ml | Where-Object { $_.t -match '\b(Resume|Leave|Reset Character)\b' }).Count)
          if ($menu -ne $lastMenu) { $lastMenu = $menu; Write-Output (@{ app = 'roblox'; menu = $menu } | ConvertTo-Json -Compress) }
        }
        $menuLum = $lum
      }
      if (-not $chatOpen) { $wait = 2000 }
    }
  } catch { $msgList = $null; $msgTab = $null }
}
`;

/* -------------------------------------------- what Roblox's chat box shows */

// "[Name]: message", "Name: message", "[To Name]: ...", "From Name: ..." (the chat box's formats).
const CHAT_LINE = /^\s*(?:\[(?:to |from )?([^\]]{2,32})\]|(?:from |to )?([A-Za-z0-9_ .]{2,32})):\s+(.{1,300})$/i;
const CHAT_HINT = /to chat click here|press ["'/]?\/["']? (key )?to chat|type here to chat/i;

/**
 * The messages in the text read from Roblox's chat box: who wrote each one and what, with lines that wrapped joined
 * back to the message they belong to. `open`: whether the chat box is showing at all (messages, or its "To chat"
 * hint), so nothing is read while it is closed.
 */
function robloxMessages(lines) {
  const out = [];
  let open = false;
  for (const l of (Array.isArray(lines) ? lines : [])) {
    const text = String(l.t || '').trim();
    if (!text) continue;
    if (CHAT_HINT.test(text)) { open = true; continue; }
    const m = CHAT_LINE.exec(text);
    if (m) {
      open = true;
      out.push({ who: (m[1] || m[2]).trim(), text: m[3].trim(), x: l.x, y: l.y, w: l.w, h: l.h });
    } else if (out.length && Math.abs((l.y || 0) - ((out[out.length - 1].y || 0) + (out[out.length - 1].h || 0))) < 30) {
      // A wrapped line: the rest of the message above it.
      const last = out[out.length - 1];
      last.text = `${last.text} ${text}`.slice(0, 600);
      last.h = (l.y + l.h) - last.y;
      last.w = Math.max(last.w, l.w);
    }
  }
  return { open, messages: out };
}

/* ------------------------------------------- what Phone Link's texts show */

// What sits beside a message without being part of it: its time, its day, whether it was delivered.
const STAMP = /^(\d{1,2}:\d{2}\s*([ap]\.?m\.?)?|today|yesterday|(mon|tues|wednes|thurs|fri|satur|sun)day|sent|delivered|read|failed|not delivered)$/i;
const COMPOSER = /^(send a message|type a message|text message|message)$/i;

/** A message's text without the time Phone Link writes after it. */
function textOf(t) {
  return String(t || '').replace(/\s+/g, ' ').replace(/(\s+(\d{1,2}:\d{2}\s*([ap]\.?m\.?)?|sent|delivered|read))+\s*$/i, '').trim().slice(0, 1500);
}

/**
 * Whether a bubble was received: received texts sit against the left of the conversation, sent ones against the right,
 * so the side with the smaller gap is the side it leans on. This holds for a full-width conversation (a narrow window)
 * and for a long message that spans most of it.
 */
function receivedSide(left, right, areaLeft, areaRight) {
  return (left - areaLeft) <= (areaRight - right);
}

/**
 * The texts in a conversation read with the text recogniser (when Phone Link cannot be read through the accessibility
 * interface): who it is with (the top line of the header), and each received message, its lines joined back together.
 * `pane`: [x, y, w, h] of the part of the window that was read. Lines are joined into bubbles first, so a short last
 * line of a sent message is not mistaken for a received one.
 */
function phonelinkMessages(lines, pane) {
  const [px, py, pw, ph] = Array.isArray(pane) ? pane : [0, 0, 0, 0];
  const header = py + Math.max(60, ph * 0.12);
  const footer = py + ph * 0.9;
  let who = '';
  const out = [];
  let last = null;
  const sorted = (Array.isArray(lines) ? lines : []).filter((l) => l && String(l.t || '').trim()).sort((a, b) => a.y - b.y);
  for (const l of sorted) {
    const text = String(l.t).trim();
    if (l.y < header) { if (!who) who = text; continue; }
    if (l.y > footer || STAMP.test(text) || COMPOSER.test(text)) { last = null; continue; }
    // The next line of the same bubble: just below, starting where it starts.
    if (last && l.y - (last.y + last.h) < Math.max(10, l.h * 0.9) && Math.abs(l.x - last.x) < 40) {
      last.text = `${last.text} ${text}`.slice(0, 1500);
      last.h = (l.y + l.h) - last.y;
      last.w = Math.max(last.w, (l.x + l.w) - last.x);
      continue;
    }
    last = { text, x: l.x, y: l.y, w: l.w, h: l.h };
    out.push(last);
  }
  return { who, messages: out.filter((m) => receivedSide(m.x, m.x + m.w, px, px + pw)) };
}

/* ------------------------------------------------ which game, from its log */

// Roblox's own log (%LOCALAPPDATA%\Roblox\logs): the lines it writes when it joins a game and when it leaves one.
const JOIN = /! Joining game '[^']*' place (\d+)/;
const LEAVE = /(leaveUGCGameInternal|Time to disconnect replication data|Client:Disconnect)/;

/** Follows the log text: { inGame, placeId } after the lines seen so far. */
function readLog(text, state = { inGame: false, placeId: null }) {
  let s = { ...state };
  for (const line of String(text).split(/\r?\n/)) {
    const j = JOIN.exec(line);
    if (j) { s = { inGame: true, placeId: j[1] }; continue; }
    if (LEAVE.test(line)) s = { inGame: false, placeId: null };
  }
  return s;
}

// Asynchronous, like everything this does on a timer: a busy disk once held the main thread (the clipboard shield, the
// live marks) for 3 seconds in one look at this folder.
async function newestLog() {
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Roblox', 'logs');
  try {
    const files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.log')).map((f) => path.join(dir, f));
    const dated = await Promise.all(files.map((f) => fs.promises.stat(f).then((st) => ({ f, t: st.mtimeMs, size: st.size }), () => null)));
    return dated.filter(Boolean).sort((a, b) => b.t - a.t)[0] || null;
  } catch { return null; }
}

/* ------------------------------------------- the game's name and description */

const games = new Map();
function getJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { Accept: 'application/json' }, timeout: 6000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 200000) body += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
/** A game's public name, description and genre, by its place number (Roblox's public game pages). */
async function gameInfo(placeId) {
  if (!/^\d{1,20}$/.test(String(placeId))) return null;
  if (games.has(placeId)) return games.get(placeId);
  const p = (async () => {
    const u = await getJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!u || !u.universeId) return null;
    const g = await getJson(`https://games.roblox.com/v1/games?universeIds=${u.universeId}`);
    const d = g && Array.isArray(g.data) && g.data[0];
    return d ? { game: String(d.name || '').slice(0, 120), description: String(d.description || '').slice(0, 1500), genre: String(d.genre || '').slice(0, 60) } : null;
  })();
  games.set(placeId, p);
  return p;
}

/* ------------------------------------------------------------- the watcher */

/** Discord's window title: "#channel | Server - Discord", "@name - Discord", or "Friends - Discord". */
function discordContext(title) {
  const t = String(title || '').replace(/\s+-\s+Discord\s*$/i, '');
  const m = /^#?(.+?)\s+\|\s+(.+)$/.exec(t);
  if (m) return { channel: m[1].replace(/^#/, ''), server: m[2], dm: false };
  return { channel: t.replace(/^@/, ''), server: '', dm: /^@/.test(t) || !t.includes('|') };
}

const APP_OF = { discord: 'discord', robloxplayerbeta: 'roblox', phoneexperiencehost: 'phonelink', yourphone: 'phonelink' };
const PARK_MS = 10 * 60 * 1000;     // this long with no watched app in front, and the reader ends
const HUNG_MS = 30 * 1000;          // this long without a word while reading, and it is taken for stuck
const STEADY_MS = 60 * 1000;        // up this long, and earlier failures no longer count
const NO_HELPER_MS = 60 * 1000;     // this long not knowing which window is in front, and chat is not being watched

let opts = null;
let active = false;              // switched on
let child = null;
let reader = 'ok';               // 'ok', 'restarting' (it died, coming back), 'stopped' (it will not stay up)
let quickExits = 0;
let retryTimer = null;
let parkTimer = null;
let dogTimer = null;
let steadyTimer = null;
let helperTimer = null;
let lostHelper = false;
let frontName;                   // the process in front; undefined until the helper says, null while it is gone
let frontHandle = '';
let inFront = null;              // the watched app in front, told to the reader
const chats = new Map();      // a conversation per chat: game or channel
const told = new Map();       // what was already pointed out, so a message is flagged once
let roblox = { inGame: false, placeId: null, menu: false, info: null, logFile: null, logAt: 0, open: true, flags: [] };
let logTimer = null;
// How many messages were checked and flagged in each app since chat safety started: numbers only, never what they said.
const fresh = () => ({ discord: { checked: 0, flagged: 0 }, roblox: { checked: 0, flagged: 0 }, phonelink: { checked: 0, flagged: 0, unchecked: 0, why: '', otherTab: false }, app: null, reading: false, blind: null, at: 0 });
let seen = fresh();
let seenTimer = null;
let apps = ['discord', 'roblox'];
let lastPhone = null;          // Phone Link's latest reading, drawn again when a link check comes back
let saidNoList = false;
// The person's week (main.js counts it): one message checked, and whether it was pointed out. Numbers only.
function counted(checked, flagged) { if (opts && opts.onCounted) opts.onCounted({ checked, flagged }); }
function noteSeen() { if (!seenTimer) seenTimer = setTimeout(() => { seenTimer = null; if (opts && opts.onSeen) opts.onSeen(); }, 3000); }

function chatFor(key, context) {
  if (!chats.has(key)) chats.set(key, conversation(context));
  return chats.get(key);
}

function judge(app, key, context, messages) {
  const c = chatFor(key, context);
  const flags = [];
  for (const m of messages) {
    if (!m.text) continue;
    // Each message is judged once, however often it stays on screen.
    const id = `${key}|${m.k || ''}|${m.who}|${m.text}`;
    if (told.has(id)) { const f = told.get(id); if (f) flags.push({ ...f, rect: { x: m.x, y: m.y, w: m.w, h: m.h } }); continue; }
    const f = c.add({ who: m.who, text: m.text });
    told.set(id, f ? { ...f, app } : null);
    seen[app].checked++;
    if (f) seen[app].flagged++;
    counted(1, f ? 1 : 0);
    noteSeen();
    if (told.size > 2000) told.delete(told.keys().next().value);
    if (f) flags.push({ ...f, app, rect: { x: m.x, y: m.y, w: m.w, h: m.h } });
  }
  return flags;
}

/**
 * Texts in Phone Link: each received message judged once (server/lib/scan/texts.js, here on this computer), and its
 * links checked by address only, the way a copied link is: never opened. A link check that comes back dangerous makes
 * the text's warning stronger, and the warning is drawn again.
 */
function judgeTexts(who, messages) {
  const flags = [];
  for (const m of messages) {
    const text = textOf(m.text);
    if (!text) continue;
    const id = `phonelink|${who}|${m.k || ''}|${text}`;
    let entry = told.get(id);
    if (entry === undefined) {
      const r = texts.judgeText({ from: who, text });
      entry = { flag: r.flag, app: 'phonelink' };
      told.set(id, entry);
      seen.phonelink.checked++;
      if (r.flag) seen.phonelink.flagged++;
      counted(1, r.flag ? 1 : 0);
      noteSeen();
      if (told.size > 2000) told.delete(told.keys().next().value);
      if (r.links.length && opts && opts.api) checkLinks(id, r);
    }
    if (entry && entry.flag) flags.push({ ...entry.flag, app: 'phonelink', rect: { x: m.x, y: m.y, w: m.w, h: m.h } });
  }
  return flags;
}
function checkLinks(id, result) {
  // Private: no history entry and nothing sent to a registry, as for a private browser window. `purpose`: checked
  // against the lists without spending live-scanning minutes, which are for browsing.
  opts.api('/api/v1/live/batch', { urls: result.links, private: true, mode: 'fast', purpose: 'texts' }).then((res) => {
    const entry = told.get(id);
    if (!entry) return;
    const flag = texts.withLinks(result, res && res.byUrl);
    if (flag === entry.flag) return;
    if (!entry.flag && flag) { seen.phonelink.flagged++; counted(0, 1); }
    if (entry.flag && !flag) seen.phonelink.flagged--;
    entry.flag = flag;
    noteSeen();
    if (lastPhone && child) onMessage(lastPhone);
  }).catch((err) => {
    // The words still count; the links were not checked, and the panel says so and why.
    seen.phonelink.unchecked += result.links.length;
    seen.phonelink.why = whyUnchecked(err);
    noteSeen();
  });
}
/** Why a text's links could not be checked, in plain words for the panel. */
function whyUnchecked(err) {
  if (err && err.status === 429) return String(err.message || 'Too many links to check just now');
  if (err && err.message === 'scanner not ready') return "Sentinel's scanner was still starting";
  return "Sentinel's scanner could not be reached";
}

function onMessage(msg) {
  if (msg.error) { opts.log(`chat safety: ${msg.error}`); return; }
  // Windows hands over only black for this window: it is in front and nothing can be read, which is not "chat closed".
  if (typeof msg.blind === 'boolean') { seen.blind = msg.blind ? msg.app : null; if (msg.blind) seen.reading = false; noteSeen(); return; }
  if (msg.app !== 'phonelink') lastPhone = null;
  if (msg.app === null) { seen.app = null; seen.reading = false; seen.blind = null; noteSeen(); opts.onState({ app: null }); return; }
  seen.app = msg.app; seen.at = Date.now();
  if (msg.app === 'discord') {
    const ctx = discordContext(msg.title);
    // Messages are grouped under one name: a message with none belongs to the one above it.
    let who = '';
    const items = (msg.items || []).map((i) => { if (i.who) who = i.who; return { ...i, who: i.who || who, text: i.t }; });
    const key = `discord|${ctx.server}|${ctx.channel}`;
    if (msg.noList && !saidNoList) { saidNoList = true; opts.log('chat safety: Discord is in front, but its message list cannot be read yet'); }
    seen.reading = !msg.noList;
    noteSeen();
    const flags = judge('discord', key, ctx, items);
    opts.onState({ app: 'discord', win: msg.win, indicator: true, reading: !msg.noList, flags });
    return;
  }
  if (msg.app === 'phonelink') {
    lastPhone = msg;
    // Calls, photos or notifications are open: nothing is read there, and the badge does not claim otherwise.
    seen.phonelink.otherTab = Boolean(msg.noTab);
    if (msg.noTab) { seen.reading = false; noteSeen(); opts.onState({ app: 'phonelink', win: msg.win, indicator: false, reading: false, flags: [] }); return; }
    let who = String(msg.who || '');
    let items;
    if (Array.isArray(msg.items)) items = msg.items.filter((i) => i.rx !== false).map((i) => ({ ...i, text: i.t }));
    else { const r = phonelinkMessages(msg.lines, msg.pane); who = who || r.who; items = r.messages; }
    // Read with the text recogniser and nothing came back at all: say so rather than claim to be watching.
    const reading = Array.isArray(msg.items) || (msg.ocr !== false && Array.isArray(msg.lines) && msg.lines.length > 0);
    seen.reading = reading;
    noteSeen();
    const flags = judgeTexts(who.slice(0, 80), items);
    opts.onState({ app: 'phonelink', win: msg.win, indicator: true, reading, flags });
    return;
  }
  if (msg.app === 'roblox') {
    // The Esc menu opened or closed: the badge changes, and the warnings by the chat box stay.
    if (typeof msg.menu === 'boolean') { roblox.menu = msg.menu; opts.onState(robloxState(roblox.flags)); return; }
    const { open, messages } = robloxMessages(msg.lines);
    // A closed chat box is not read: the reader is told, and looks only for it coming back.
    if (open !== roblox.open) { roblox.open = open; send(open ? 'chat open' : 'chat closed'); }
    roblox.win = msg.win;
    seen.reading = open;
    noteSeen();
    roblox.area = msg.area;
    if (!open) { roblox.flags = []; opts.onState(robloxState([])); return; }
    const ctx = roblox.inGame ? { ...(roblox.info || {}), place: roblox.placeId } : { game: 'Roblox app', description: 'friends and chat' };
    const flags = judge('roblox', `roblox|${roblox.inGame ? roblox.placeId : 'app'}`, ctx, messages);
    roblox.flags = flags;
    opts.onState(robloxState(flags));
  }
}

// In a game the badge shows only with the Esc menu open; warnings always show, small, by the chat box.
function robloxState(flags) {
  return { app: 'roblox', win: roblox.win, area: roblox.area, indicator: !roblox.inGame || roblox.menu, inGame: roblox.inGame, flags };
}

let following = false;
async function followLog() {
  if (following) return;
  following = true;
  try {
    const newest = await newestLog();
    if (!newest) return;
    if (newest.f !== roblox.logFile) { roblox.logFile = newest.f; roblox.logAt = 0; }
    const size = newest.size;
    if (size < roblox.logAt) roblox.logAt = 0;
    if (size === roblox.logAt) return;
    const start = Math.max(roblox.logAt, size - 2 * 1024 * 1024);
    const fh = await fs.promises.open(newest.f, 'r');
    const buf = Buffer.alloc(size - start);
    try { await fh.read(buf, 0, buf.length, start); } finally { await fh.close(); }
    roblox.logAt = size;
    const before = roblox.placeId;
    const wasInGame = roblox.inGame;
    const s = readLog(buf.toString('utf8'), { inGame: roblox.inGame, placeId: roblox.placeId });
    roblox.inGame = s.inGame;
    roblox.placeId = s.placeId;
    // Joined or left while Roblox is in front, after its chat was last read: the overlay changes now (in a game the
    // badge waits for the Esc menu), not at the next new message, which may be a long time coming.
    if (s.inGame !== wasInGame && seen.app === 'roblox' && opts) opts.onState(robloxState(roblox.flags));
    if (s.placeId && s.placeId !== before) {
      roblox.info = null;
      gameInfo(s.placeId).then((info) => { if (roblox.placeId === s.placeId) roblox.info = info; });
    }
  } catch { /* the log is being rotated: next time */ } finally { following = false; }
}

function send(line) { try { if (child && child.stdin.writable) child.stdin.write(`${line}\n`); } catch { /* gone */ } }

const NAMES = { discord: 'Discord', roblox: 'Roblox', phonelink: 'Phone Link' };
function watching() { return apps.map((a) => NAMES[a]).join(' and ').replace(/ and (?=.* and )/g, ', '); }

/**
 * Which apps are read: chat safety's (Discord, Roblox) and text checking's (Phone Link) are switched on separately.
 * An app that is not in the list is never read, even in front.
 */
function setApps(list) {
  const next = (Array.isArray(list) ? list : []).filter((a) => NAMES[a]);
  if (next.join(',') === apps.join(',')) return;
  apps = next;
  if (active && opts) opts.log(`chat safety: now watching ${watching() || 'nothing'} while in front`);
  place();
}

function setReader(next) {
  if (next === reader) return;
  reader = next;
  if (opts) { opts.log(`chat safety: reader ${next}`); if (opts.onReader) opts.onReader(next); }
}

/** Anything the reader says shows it is alive. While it should be reading, silence for too long means it is stuck. */
function beat(mine, ms = HUNG_MS) {
  clearTimeout(dogTimer);
  dogTimer = inFront && child === mine ? setTimeout(() => { opts.log('chat safety: the reader stopped answering'); try { mine.kill(); } catch { /* gone */ } }, ms) : null;
}

/** The reader for the app in front: started only now, with what it needs to know. */
function launch() {
  if (child || retryTimer || !opts) return;
  const startedAt = Date.now();
  let mine;
  let ended = false;
  const gone = (code) => {
    if (ended) return;
    ended = true;
    if (child !== mine) return;   // ended on purpose
    child = null;
    clearTimeout(dogTimer); clearTimeout(steadyTimer);
    // Only how it ended: what it wrote on the way out could be about a chat.
    opts.log(`chat safety: the reader ended (${code})`);
    onMessage({ app: null });
    quickExits = Date.now() - startedAt > STEADY_MS ? 0 : quickExits + 1;
    setReader(quickExits >= 3 ? 'stopped' : 'restarting');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (inFront) launch();
      else if (reader === 'restarting') setReader('ok');   // nothing to read: it starts when there is
    }, Math.min(300000, 3000 * 2 ** Math.max(0, quickExits - 1)));
  };
  try { mine = (opts.spawn || spawn)('powershell.exe', LAUNCH, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); } catch (err) { mine = { kill() {} }; child = mine; gone(err.code || 'could not start'); return; }
  child = mine;
  mine.on('error', (err) => gone(err.code || 'error'));
  mine.on('exit', (code) => gone(code));
  mine.stdin.on('error', () => { /* it ended: 'exit' takes it from here */ });
  // Below normal priority: reading a chat must never compete with the game it is in.
  try { os.setPriority(mine.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
  mine.stdin.write(`${Buffer.from(SCRIPT, 'utf8').toString('base64')}\n`);
  require('readline').createInterface({ input: mine.stdout }).on('line', (l) => {
    if (child !== mine) return;
    beat(mine);
    let msg;
    try { msg = JSON.parse(l); } catch { return; }
    if (msg.alive) return;
    if (msg.ready) { if (quickExits < 3) setReader('ok'); return; }
    // Said just as the app left the front: too late to be true.
    if (msg.app && msg.app !== inFront) return;
    onMessage(msg);
  });
  steadyTimer = setTimeout(() => { quickExits = 0; setReader('ok'); }, STEADY_MS);
  beat(mine, HUNG_MS * 2);   // its first start compiles
  if (inFront) send(`front ${inFront} ${frontHandle}`);
}

/** Tells the reader what is in front now: started if it is needed, put to sleep if it is not. */
function place() {
  if (!active) return;
  const app = APP_OF[frontName] && apps.includes(APP_OF[frontName]) ? APP_OF[frontName] : null;
  if (!app) {
    if (!inFront) return;
    inFront = null;
    clearTimeout(dogTimer);
    clearInterval(logTimer); logTimer = null;
    send('front -');
    onMessage({ app: null });
    clearTimeout(parkTimer);
    parkTimer = setTimeout(() => { const old = child; child = null; clearTimeout(steadyTimer); if (old) { try { old.kill(); } catch { /* gone */ } } }, PARK_MS);
    return;
  }
  clearTimeout(parkTimer);
  const arriving = inFront !== app;
  inFront = app;
  if (app === 'roblox' && !logTimer) { logTimer = setInterval(followLog, 2000); followLog(); }
  if (app !== 'roblox' && logTimer) { clearInterval(logTimer); logTimer = null; }
  if (!child) { launch(); return; }
  if (arriving) onMessage({ app: null });
  send(`front ${app} ${frontHandle}`);
  beat(child);
}

/**
 * Which window is in front, from the helper (browsers.frontListen): its process, lower case, and its handle. null when
 * the helper ended: nobody then knows what is in front, so nothing can be read, and if that lasts it is said.
 */
function front(name, handle) {
  clearTimeout(helperTimer);
  frontName = name;
  frontHandle = String(handle || '');
  if (name === null) {
    lostHelper = true;
    if (active && reader === 'ok') setReader('restarting');
    helperTimer = setTimeout(() => { if (active) setReader('stopped'); }, NO_HELPER_MS);
  } else if (lostHelper) {
    lostHelper = false;
    if (!retryTimer && quickExits < 3) setReader('ok');
  }
  place();
}

/**
 * @param {{ log: (s: string) => void, onState: (s: object) => void, onSeen?: () => void, apps?: string[],
 *   api?: (path: string, body: object) => Promise<object> }} o  api: checks the addresses of links in texts
 */
// How the reader starts: its script arrives as the first line on its input (too long for a command line), read with a
// plain reader over the raw stream ($in, which the script goes on reading its commands from), and runs with `&` so
// each line it writes reaches Sentinel at once (a script block's Invoke() would hold them all until it ends).
const LAUNCH = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
  '$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput()); & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($in.ReadLine()))))'];

function start(o) {
  if ((process.platform !== 'win32' && !o.spawn) || active) return;
  opts = o;
  active = true;
  if (o.apps) apps = o.apps.filter((a) => NAMES[a]);
  o.log(`chat safety: watching ${watching()} while in front`);
  // The helper has not said yet (Sentinel is starting): it has a minute, as when it dies.
  if (frontName === undefined) helperTimer = setTimeout(() => { if (active) setReader('stopped'); }, NO_HELPER_MS);
  place();
}

function stop() {
  active = false;
  inFront = null;
  quickExits = 0;
  for (const t of [retryTimer, parkTimer, dogTimer, steadyTimer, helperTimer]) clearTimeout(t);
  retryTimer = null;
  lostHelper = false;
  clearInterval(logTimer);
  logTimer = null;
  reader = 'ok';
  if (child) { const old = child; child = null; try { old.kill(); } catch { /* gone */ } }
  chats.clear();
  told.clear();
  seen = fresh();
  lastPhone = null;
  if (opts) opts.onState({ app: null });
}

module.exports = {
  start, stop, setApps, front, on: () => active, reader: () => reader, running: () => active && reader !== 'stopped', stats: () => JSON.parse(JSON.stringify(seen)),
  _test: { followLog, state: () => ({ inGame: roblox.inGame, placeId: roblox.placeId, logFile: roblox.logFile, logAt: roblox.logAt, following, timer: Boolean(logTimer), child: Boolean(child) }), SCRIPT, LAUNCH, onMessage, robloxMessages, readLog, discordContext, judge, phonelinkMessages, receivedSide, judgeTexts, textOf, setOpts: (o) => { opts = o; } }
};
