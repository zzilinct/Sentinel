'use strict';
/**
 * Live scanning: protection inside any browser with no add-on at all.
 *
 * Windows exposes every browser's current page through UI Automation, the
 * same accessibility layer screen readers use. While live scanning is on and a
 * browser is the window in front, Sentinel asks it, about twice a second:
 *
 *   - which page is showing          -> the address is checked; a dangerous page
 *                                       gets a warning
 *   - where the page sits on screen  -> so the overlay (overlay.js) can put the
 *                                       gold line, the corner mask and the marks
 *                                       exactly over it
 *   - on a search results page, which links are on screen and where
 *                                    -> each one is checked and gets its mark
 *
 * What this can and cannot do:
 *   - It reads addresses: of the page, and of the links on a results page. It
 *     never reads page text, form fields or anything typed.
 *   - It only works on the window in front. A browser that is minimised, behind
 *     another program, or left alone for two minutes is not "in use": nothing is
 *     read, nothing is checked, and no live time is spent.
 *   - Private windows (InPrivate, Incognito, Private Browsing) are protected the
 *     same way, and nothing about them is kept: no history, no log line, no
 *     entry in the app's live feed.
 *   - Windows only for now. Other platforms report "not available".
 *
 * The reader is a small PowerShell loop, started hidden. Its script is written
 * to the app's data folder and run by a short loader that checks its SHA-256
 * (see readerLaunch). It prints one JSON line when something changes; this
 * module does the rest.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RECHECK_MS = 10 * 60 * 1000;     // same host warned again after this long
const SETTLE_MS = 350;                 // a page must stay in front this long before it is checked (long enough to skip pages flicked past)
const VERDICT_TTL_MS = 10 * 60 * 1000; // a link's verdict is reused this long (scrolling re-reads the same links)
const MAX_LINKS = 40;
const RETRY_MS = 5000;                 // a failed results check is tried again after this long

// Foreground window -> owning process -> the page's document element -> its URL, its rectangle, its links.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
# UTF-8 out, as the app reads it: in the console's own code page every letter outside English (an address in
# another alphabet, an accented name) arrived damaged.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
# Compiling this takes a second or more of CPU on every start. Compile it once into the app's data folder and load it from there afterwards.
$dll = '__HELPER_DLL__'
$src = @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class SW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static uint IdleMs() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Restore if minimised, maximise, and bring to the front. Windows only lets the program in front hand over the
  // foreground, so Alt is tapped first (the documented way to be allowed).
  public static void Raise(IntPtr h) { ShowWindow(h, 3); keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(h); }
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  // The browser's own window, not a menu or popup it opened (those are owned by it).
  public static IntPtr Owner(IntPtr h) { IntPtr r = GetAncestor(h, 3); return r == IntPtr.Zero ? h : r; }
  // Put the overlay directly above the browser, and no higher: whatever is already above the browser (its menus,
  // another program's window, a notification) stays above the overlay. Does nothing when it is already above.
  public static bool Above(IntPtr overlay, IntPtr browser) {
    if (overlay == IntPtr.Zero || browser == IntPtr.Zero) return false;
    IntPtr w = GetWindow(browser, 3);
    for (int n = 0; w != IntPtr.Zero && n < 400; n++) { if (w == overlay) return false; w = GetWindow(w, 3); }
    IntPtr prev = GetWindow(browser, 3);
    // Below a topmost window would make the overlay topmost too: then it goes to the top of the ordinary windows.
    IntPtr after = (prev == IntPtr.Zero || (GetWindowLong(prev, -20) & 0x8) != 0) ? IntPtr.Zero : prev;
    return SetWindowPos(overlay, after, 0, 0, 0, 0, 0x1 | 0x2 | 0x10 | 0x200);
  }
}

// The mouse wheel, the moment it turns, so marks can move with the page's own smooth scroll instead of waiting for
// the browser to report where its links went (only a few times a second). Raw input: Windows hands a copy of each
// wheel movement to a hidden window here; nothing is intercepted or held up, the keyboard is never read, and
// nothing is sent unless Enabled (a results page with marks is in front).
public class Wheel : System.Windows.Forms.NativeWindow {
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort UsagePage; public ushort Usage; public uint Flags; public IntPtr Target; }
  [DllImport("user32.dll")] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr raw, uint command, IntPtr data, ref uint size, uint headerSize);
  public static volatile bool Enabled;
  public static volatile bool Registered;   // Windows is sending the mouse now (only while Enabled)
  public static int Seen;                   // raw input messages seen, sent or not (for the log)
  public static int Msgs;                   // any message at all: tells a dead window from a quiet mouse
  public static volatile int LastWheel;     // when the wheel last turned (TickCount), so the page's place is confirmed after
  static bool started;
  // Held here for the life of the process, so the window cannot be collected once the thread is inside
  // Application.Run and nothing else refers to it.
  static Wheel instance;
  static System.Windows.Forms.Timer sync;
  public static void Start() {
    if (started) return;
    started = true;
    var t = new System.Threading.Thread(() => {
      var w = new Wheel();
      instance = w;
      var cp = new System.Windows.Forms.CreateParams();
      cp.Parent = new IntPtr(-3);   // a message-only window: never shown
      w.CreateHandle(cp);
      // Windows is asked for the mouse only while marks are on screen, and told to stop the moment they are not: a
      // gaming mouse reports thousands of times a second, and every report would wake this process during a game.
      sync = new System.Windows.Forms.Timer();
      sync.Interval = 200;
      sync.Tick += (s, e) => w.Sync();
      sync.Start();
      System.Windows.Forms.Application.Run();
    });
    t.IsBackground = true;
    t.SetApartmentState(System.Threading.ApartmentState.STA);
    t.Start();
  }
  void Sync() {
    if (Enabled == Registered) return;
    // The mouse, and a precision touchpad (its scrolling never arrives as a wheel): only that fingers are on it, which
    // wakes the page follower (Glide). Neither is held up; the keyboard is never asked for.
    var d = new RAWINPUTDEVICE[2];
    d[0].UsagePage = 1; d[0].Usage = 2;
    d[1].UsagePage = 0x0D; d[1].Usage = 0x05;
    // On: even when this window is not in front (RIDEV_INPUTSINK). Off: RIDEV_REMOVE, no window.
    for (int i = 0; i < 2; i++) { if (Enabled) { d[i].Flags = 0x100; d[i].Target = Handle; } else { d[i].Flags = 0x1; d[i].Target = IntPtr.Zero; } }
    if (RegisterRawInputDevices(d, 2, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)))) Registered = Enabled;
    // A touchpad-less machine refuses the pair on some versions: the mouse alone, as before.
    else if (RegisterRawInputDevices(new[] { d[0] }, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)))) Registered = Enabled;
  }
  static bool held;   // a mouse button is down: dragging the scrollbar or a selection moves the page too
  protected override void WndProc(ref System.Windows.Forms.Message m) {
    System.Threading.Interlocked.Increment(ref Msgs);
    if (m.Msg == 0x00FF) System.Threading.Interlocked.Increment(ref Seen);
    if (m.Msg == 0x00FF && Enabled) {
      uint header = (uint)(8 + 2 * IntPtr.Size);
      uint size = 0;
      GetRawInputData(m.LParam, 0x10000003, IntPtr.Zero, ref size, header);
      if (size > 0 && size < 1024) {
        IntPtr buf = Marshal.AllocHGlobal((int)size);
        try {
          int kind = GetRawInputData(m.LParam, 0x10000003, buf, ref size, header) == size ? Marshal.ReadInt32(buf) : -1;
          // A touchpad (RIM_TYPEHID): fingers on it may be scrolling the page.
          if (kind == 2) Glide.Poke(450);
          if (kind == 0) {
            ushort flags = (ushort)Marshal.ReadInt16(buf, (int)header + 4);
            if ((flags & 0x0001) != 0 || (flags & 0x0004) != 0 || (flags & 0x0010) != 0) held = true;
            if ((flags & 0x0002) != 0 || (flags & 0x0008) != 0 || (flags & 0x0020) != 0) held = false;
            if (held) Glide.Poke(300);
            if ((flags & 0x0400) != 0) {
              short delta = Marshal.ReadInt16(buf, (int)header + 6);
              LastWheel = Environment.TickCount;
              Glide.Poke(700);
              Console.Out.WriteLine("{\"wheel\":" + delta + ",\"t\":" + Environment.TickCount + "}");
              Console.Out.Flush();
            }
          }
        } finally { Marshal.FreeHGlobal(buf); }
      }
    }
    base.WndProc(ref m);
  }
}

// The page itself, followed by its pixels while it scrolls: a narrow band of the results' own text is copied from the
// screen about 60 times a second and compared with the last copy to see how far it moved. That is the page's real
// movement a frame after it happens, whatever moved it (a wheel's smooth scroll, a touchpad, the scrollbar), where the
// browser itself says where its links went only every 150-300 ms. Only while something is scrolling (Poke), only the
// band (Region), and nothing is kept: each copy is reduced to one brightness number per row and dropped.
public class Glide {
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
  [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);
  public static volatile bool Enabled;
  public static volatile int Until;
  static int rx, ry, rw, rh;
  static readonly object gate = new object();
  static bool started;
  public static int Sent;   // movements reported (for the log)
  // How far the page has moved since the last full read, by its pixels, and when it last moved: the reader waits for
  // the browser's own positions to catch up with this before it reads the links again (a read taken before then
  // put every mark where its result had been).
  public static volatile int Total;
  public static volatile int LastMove;
  public static void Poke(int ms) { int u = Environment.TickCount + ms; if (u - Until > 0) Until = u; }
  public static void Region(int x, int y, int w, int h) { lock (gate) { rx = x; ry = y; rw = Math.Max(0, w); rh = Math.Max(0, h); } }
  public static void Start() {
    if (started) return;
    started = true;
    var t = new System.Threading.Thread(Run);
    t.IsBackground = true;
    t.Priority = System.Threading.ThreadPriority.AboveNormal;
    t.Start();
  }
  static int[] Profile(System.Drawing.Bitmap bmp, System.Drawing.Graphics g, int x, int y, int w, int h) {
    g.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h), System.Drawing.CopyPixelOperation.SourceCopy);
    var data = bmp.LockBits(new System.Drawing.Rectangle(0, 0, w, h), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppRgb);
    var p = new int[h];
    try {
      var row = new int[w];
      for (int i = 0; i < h; i++) {
        Marshal.Copy(data.Scan0 + i * data.Stride, row, 0, w);
        int s = 0;
        for (int j = 0; j < w; j += 2) { int c = row[j]; s += ((c >> 16) & 255) * 3 + ((c >> 8) & 255) * 6 + (c & 255); }
        p[i] = s;
      }
    } finally { bmp.UnlockBits(data); }
    return p;
  }
  // How far the band moved between two copies: the shift that lines them up best, if one clearly does.
  public static int Shift(int[] a, int[] b, int max, out bool sure) {
    sure = false;
    int n = Math.Min(a.Length, b.Length);
    if (n < 80) return 0;
    long same = 0;
    for (int i = 0; i < n; i++) same += Math.Abs(a[i] - b[i]);
    double base0 = (double)same / n;
    // Nothing changed (or only a little: a cursor blinking): still.
    if (base0 < 40) { sure = true; return 0; }
    // A band without detail (blank page edge) cannot be lined up.
    long lo = long.MaxValue, hi = 0; for (int i = 0; i < n; i += 4) { lo = Math.Min(lo, a[i]); hi = Math.Max(hi, a[i]); }
    if (hi - lo < 600) return 0;
    double best = double.MaxValue; int at = 0;
    for (int s = -max; s <= max; s++) {
      if (s == 0) continue;
      int from = Math.Max(0, -s), to = Math.Min(n, n - s);
      if (to - from < n / 2) continue;
      long sum = 0;
      for (int i = from; i < to; i++) { sum += Math.Abs(b[i] - a[i + s]); if (sum > best * (to - from)) break; }
      double v = (double)sum / (to - from);
      if (v < best) { best = v; at = s; }
    }
    // Clearly the page moving, not something on it changing (a video, an image loading in): the shifted copy must line
    // up far better than the unmoved one.
    if (best < base0 * 0.35) { sure = true; return at; }
    return 0;
  }
  static void Run() {
    System.Drawing.Bitmap bmp = null; System.Drawing.Graphics g = null; int[] prev = null; int bw = 0, bh = 0;
    bool fast = false;
    var clock = System.Diagnostics.Stopwatch.StartNew();
    while (true) {
      try {
        int x, y, w, h;
        lock (gate) { x = rx; y = ry; w = rw; h = rh; }
        if (!Enabled || w < 16 || h < 120) {
          if (fast) { timeEndPeriod(1); fast = false; }
          prev = null;
          System.Threading.Thread.Sleep(40);
          continue;
        }
        // Between scrolls the band is looked at a few times a second, so the first frame of a scroll always has a
        // copy from before it to compare with (otherwise the first notch was missed), and a page moved by the
        // keyboard is followed too. While something scrolls, every frame.
        bool woken = Environment.TickCount - Until <= 0;
        if (woken && !fast) { timeBeginPeriod(1); fast = true; }
        if (!woken && fast) { timeEndPeriod(1); fast = false; }
        long t0 = clock.ElapsedMilliseconds;
        if (bmp == null || bw != w || bh != h) {
          if (g != null) g.Dispose(); if (bmp != null) bmp.Dispose();
          bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppRgb); g = System.Drawing.Graphics.FromImage(bmp); bw = w; bh = h; prev = null;
        }
        var cur = Profile(bmp, g, x, y, w, h);
        if (prev != null) {
          bool sure;
          int s = Shift(prev, cur, Math.Min(400, h / 2), out sure);
          // Content moved up by s rows: the page's links moved by -s, as the anchor reports them.
          if (sure && s != 0) {
            Sent++; Total += -s; LastMove = Environment.TickCount;
            // A movement seen between scrolls (the keyboard, a page moving itself): watch every frame for a moment.
            if (!woken) Poke(400);
            Console.Out.WriteLine("{\"px\":{\"dy\":" + (-s) + ",\"t\":" + Environment.TickCount + "}}"); Console.Out.Flush();
          }
        }
        prev = cur;
        int rest = (woken ? 16 : 120) - (int)(clock.ElapsedMilliseconds - t0);
        System.Threading.Thread.Sleep(Math.Max(1, rest));
      } catch { prev = null; System.Threading.Thread.Sleep(50); }
    }
  }
}
"@
$loaded = $false
if ($dll -and (Test-Path $dll)) { try { Add-Type -Path $dll; $loaded = $true } catch { $loaded = $false } }
if (-not $loaded) {
  if ($dll) { try { Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms, System.Drawing -OutputAssembly $dll; Add-Type -Path $dll; $loaded = $true } catch { $loaded = $false } }
  if (-not $loaded) { Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms, System.Drawing }
}
Write-Output '{"ready":true}'
try { [Wheel]::Start() } catch { Write-Output (@{ wheelError = [string]$_.Exception.Message } | ConvertTo-Json -Compress) }
try { [Glide]::Start() } catch { Write-Output (@{ glideError = [string]$_.Exception.Message } | ConvertTo-Json -Compress) }
$A = [System.Windows.Automation.AutomationElement]
$VP = [System.Windows.Automation.ValuePattern]
$docCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$linkCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Hyperlink)
# Message rows in a webmail inbox: Gmail lists them as table rows (DataItem), Outlook on the web as list items.
$rowCond = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::DataItem)),
  (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
$rowCache = New-Object System.Windows.Automation.CacheRequest
$rowCache.Add($A::BoundingRectangleProperty); $rowCache.Add($A::IsOffscreenProperty); $rowCache.Add($A::NameProperty)
$rowCache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
$mail = '^https://(mail\.google\.com/mail/|outlook\.live\.com/mail/|outlook\.office(365)?\.com/mail/)'
$cache = New-Object System.Windows.Automation.CacheRequest
$cache.Add($A::BoundingRectangleProperty); $cache.Add($A::IsOffscreenProperty); $cache.Add($VP::ValueProperty); $cache.Add($A::NameProperty)
$cache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
$docCache = New-Object System.Windows.Automation.CacheRequest
$docCache.Add($A::BoundingRectangleProperty); $docCache.Add($A::IsOffscreenProperty)
# The anchor: one result link whose position is followed between full reads, so marks move WITH the page.
$anchor = $null; $anchorX = 0; $anchorY = 0; $lastDx = 0; $lastDy = 0; $moved = $false; $confirmedWheel = 0
$appCheckFor = [IntPtr]::Zero; $isApp = $false
$browsers = @('chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'duckduckgo', 'firefox', 'librewolf')
$private = '\b(InPrivate|Incognito|Private Browsing|Private Window|Privates Fenster|Navigation priv|Navegaci.n privada|Inc.gnito)\b|\(Private\)'
$search = '^https?://([a-z0-9-]+\.)*(google\.[a-z.]{2,6}/search|bing\.com/search|duckduckgo\.com/(\?|html)|search\.brave\.com/search|search\.yahoo\.com/search|ecosia\.org/search|startpage\.com/(do|sp)/|yandex\.[a-z.]{2,6}/search|mojeek\.com/search)'
$last = ''; $lastFront = ''; $lastWin = ''; $lastLinks = ''; $wasIdle = $false; $noDoc = ''; $pause = 450
$lastPid = 0; $lastProc = $null; $cachedDoc = $null; $cachedFor = [IntPtr]::Zero; $cachedTitle = ''; $cachedAt = 0
$forceRead = $true; $readAt = 0; $lastCount = 0
# The overlay's window (sent by the app once it exists) and the browser it belongs over.
$overlayH = [IntPtr]::Zero; $browserH = [IntPtr]::Zero
$lastFocus = ''; $recheckAt = 0; $lastMoveAt = 0# Not the console's own reader (Console.In): in Windows PowerShell it is synchronized, and its ReadLineAsync runs synchronously,
# so the loop would stop at the first read until the app sent a command. A plain reader over the raw stream is
# truly asynchronous.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pendingLine = $stdin.ReadLineAsync()
# Is something drawn over this link, where its mark goes (a menu the page opened, like Google's apps grid, or a bar
# that stays at the top while the page scrolls under it)? Asks what is at the link's title line: the link itself (or
# its text) means it shows. Something containing the link might be its own container (the point fell in a gap) or a
# panel over it; only a panel that is not one of the link's ancestors covers it.
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
function Covered($el, $b) {
  # The page must be where it was read: if the link has moved since (the page was still scrolling), what is at its
  # old place says nothing. Measured on a real desktop, nearly every "covered" link was one of those. Judge nothing
  # and read again shortly.
  try { $lb = $el.Current.BoundingRectangle } catch { return $false }
  if ([Math]::Abs($lb.Y - $b.Y) -gt 3 -or [Math]::Abs($lb.X - $b.X) -gt 3) { $script:staleRead = $true; return $false }
  $px = [int]($b.X + [Math]::Min(8, $b.Width / 2))
  # Where its mark goes: the title line, which is the last line of a Google result link and the first of anything
  # taller (a whole ad card).
  $py = if ($b.Height -gt 40 -and $b.Height -le 90) { [int]($b.Bottom - 12) } elseif ($b.Height -gt 90) { [int]($b.Y + 12) } else { [int]($b.Y + $b.Height / 2) }
  try {
    $hit = $A::FromPoint((New-Object System.Windows.Point($px, $py)))
    # Only the browser's own things count: another program's window (Sentinel's overlay included) is not the page.
    if (-not $hit -or $hit.Current.ProcessId -ne $fp) { return $false }
    # The browser's own interface over the page (its menus, the link preview at the bottom, the address bar) is a
    # window above the page, and the overlay already sits under it (see Above). Only the page's own panels count.
    if ($hit.Current.ClassName -cmatch '^(Label|[A-Z][A-Za-z]*Views?|MenuSeparator|Chrome_WidgetWin_\d+)$') { return $false }
    $hr = $hit.Current.BoundingRectangle
    if ([double]::IsInfinity($hr.Width)) { return $false }
    # An answer that is not even at the point (the browser's hit test and its positions out of step, seen on real
    # pages) says nothing. A menu or panel over the link always is.
    if ($px -lt $hr.Left - 2 -or $px -gt $hr.Right + 2 -or $py -lt $hr.Top - 2 -or $py -gt $hr.Bottom + 2) { $script:staleRead = $true; return $false }
    # Quick answer: something inside the link's box is (almost always) the link's own text.
    $inside = $hr.X -ge $b.X - 2 -and $hr.Y -ge $b.Y - 2 -and $hr.Right -le $b.Right + 2 -and $hr.Bottom -le $b.Bottom + 2
    if ($inside) { return $false }
    # Part of the link (its text can stick out of the link's box a little)?
    $p = $hit
    for ($i = 0; $p -and $i -lt 6; $i++) { if ([System.Windows.Automation.Automation]::Compare($p, $el)) { return $false }; $p = $walker.GetParent($p) }
    # One of the link's own containers (the point fell in a gap inside it)?
    $p = $walker.GetParent($el)
    for ($i = 0; $p -and $i -lt 12; $i++) { if ([System.Windows.Automation.Automation]::Compare($p, $hit)) { return $false }; $p = $walker.GetParent($p) }
    # Something else is there. What it is (its kind and box, never its words) goes along for the end-to-end review.
    $script:coverHit = "$($hit.Current.ControlType.ProgrammaticName) $($hit.Current.ClassName) $([int]$hr.X),$([int]$hr.Y),$([int]$hr.Width)x$([int]$hr.Height)"
    return $true
  } catch { return $false }
}
function Off($why) { $script:anchor = $null; try { [Wheel]::Enabled = $false; [Glide]::Enabled = $false } catch { }; if ($script:lastWin -ne '') { $script:lastWin = ''; $script:last = ''; $script:lastLinks = ''; Write-Output ('{"win":null,"why":"' + $why + '"}') } }
while ($true) {
  # Between full looks: follow the anchor about 60 times a second and report how far the page has moved, so the
  # marks move while the page scrolls instead of jumping after it. Wake at once for a command.
  # The wheel is reported only while there are marks to move (a results page in front): never in a game.
  try { [Wheel]::Enabled = [bool]$anchor; [Glide]::Enabled = [bool]$anchor } catch { }
  $gotCmd = $false
  $until = [Environment]::TickCount + $pause
  $moved = $false
  # Nothing to follow (no results page in front, or a game): one quiet wait, not a loop that wakes 60 times a second.
  if (-not $anchor) { if ($pendingLine.Wait([Math]::Max(1, $until - [Environment]::TickCount))) { $gotCmd = $true } }
  # While the page moves it is followed every 8 ms (every 15 ms when it is still; faster only burns CPU, since a
  # browser updates link positions only every 150-300 ms while it scrolls). The full read waits until the page has
  # been still for 350 ms, so a pause between two of those updates is not taken for the end of a scroll. A full read
  # takes a few hundred milliseconds; done in the middle of a scroll it recorded links at different moments, and the
  # marks jumped back and forth.
  $stillAt = 0; $loopStart = [Environment]::TickCount
  while ($anchor -and -not $gotCmd -and [Environment]::TickCount -lt $until) {
    # The page's pixels moved further than the browser has said its links did: its positions are behind, and a read
    # now would put every mark where its result was. Wait for them (up to a second and a half after the last move).
    try {
      if ([Glide]::Total -ne 0 -and [Math]::Abs($lastDy - [Glide]::Total) -gt 20 -and [Environment]::TickCount - [Glide]::LastMove -lt 1500) {
        $stillAt = [Environment]::TickCount + 120
        if ($until -lt $stillAt -and $stillAt - $loopStart -lt 5000) { $until = $stillAt }
      }
    } catch { }
    # A page someone is reading, not scrolling, is looked at less and less often: every call costs the browser too.
    # Marks step aside while a page moves anyway, so a scroll noticed a few dozen milliseconds later looks the same.
    $sinceMove = [Environment]::TickCount - $lastMoveAt
    $wait = if ([Environment]::TickCount -lt $stillAt) { 8 } elseif ($sinceMove -lt 1500) { 15 } elseif ($sinceMove -lt 10000) { 40 } else { 90 }
    if ($pendingLine.Wait($wait)) { $gotCmd = $true; break }
    if ($anchor) {
      try {
        $ar = $anchor.Current.BoundingRectangle
        # A link that went away reports an empty rectangle: following it would throw every mark to the top corner.
        # Let it go; the next full read places the marks again.
        if ([double]::IsInfinity($ar.Y) -or $ar.Width -lt 1 -or $ar.Height -lt 1) { $anchor = $null }
        else {
          $dx = [int]$ar.X - $anchorX; $dy = [int]$ar.Y - $anchorY
          if ($dx -ne $lastDx -or $dy -ne $lastDy) {
            $lastDx = $dx; $lastDy = $dy; $moved = $true
            Write-Output ('{"shift":{"dx":' + $dx + ',"dy":' + $dy + ',"t":' + [Environment]::TickCount + '}}')
            $stillAt = [Environment]::TickCount + 350; $lastMoveAt = [Environment]::TickCount
            # Moving by something the follower was not woken for (a touchpad it cannot hear, the keyboard): follow it now.
            try { [Glide]::Poke(450) } catch { }
            # Never more than 5 s between full reads, even on a page that keeps moving by itself.
            if ($until -lt $stillAt -and $stillAt - $loopStart -lt 5000) { $until = $stillAt }
          } else {
            # Half a second after the wheel last turned, the page's place is said again even if it did not move: a
            # wheel turned over something that does not scroll otherwise leaves the marks where the wheel sent them.
            $lw = [Wheel]::LastWheel
            if ($lw -ne $confirmedWheel -and [Environment]::TickCount - $lw -gt 500) {
              $confirmedWheel = $lw
              Write-Output ('{"shift":{"dx":' + $dx + ',"dy":' + $dy + ',"t":' + [Environment]::TickCount + '}}')
            }
          }
        }
      } catch { $anchor = $null }
    }
  }
  # The page has settled: the full read now puts every mark exactly where its link is.
  if ($moved) { $pause = 60 }
  if ($gotCmd) {
    $cmd = $pendingLine.Result
    if ($null -eq $cmd) { exit }   # the app closed the pipe: it is gone
    $pendingLine = $stdin.ReadLineAsync()
    if ($cmd -match '^above (\d{1,20})$') {
      $overlayH = [IntPtr][long]$Matches[1]
      if ($browserH -ne [IntPtr]::Zero) { [void][SW]::Above($overlayH, $browserH) }
    }
    if ($cmd -match '^raise ([a-z]{2,20})$') {
      $rp = Get-Process -Name $Matches[1] | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
      if ($rp) { [SW]::Raise($rp.MainWindowHandle); Write-Output ('{"raised":"' + $Matches[1] + '"}') } else { Write-Output ('{"noWindow":"' + $Matches[1] + '"}') }
    }
    continue
  }
  $pause = 300
  # A menu or popup the browser opened is in front of the browser's own window, which is the one that holds the page.
  $h = [SW]::Owner([SW]::GetForegroundWindow())
  # Development builds only (see start()): look at a named browser wherever it is, so the whole chain can be
  # exercised against a window nobody is looking at. In a released build this name is always empty.
  $testName = '__TEST_PROCESS__'
  if ($testName) { $tp = Get-Process -Name $testName | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1; if ($tp) { $h = $tp.MainWindowHandle } }
  if ($h -eq [IntPtr]::Zero) { continue }
  $fp = 0
  [void][SW]::GetWindowThreadProcessId($h, [ref]$fp)
  # The same window belongs to the same process: look it up once, not on every pass.
  if ($fp -ne $lastPid) { $lastPid = $fp; $lastProc = Get-Process -Id $fp }
  $p = $lastProc
  $fname = $p.ProcessName
  if ($fname -and $fname -ne $lastFront) { $lastFront = $fname; Write-Output (@{ front = $fname; isBrowser = ($browsers -contains $fname) } | ConvertTo-Json -Compress) }
  # Behind another program, minimised, or nobody at the keyboard: the browser is not "in use".
  if (-not $p -or ($browsers -notcontains $fname)) { Off 'not in front'; $pause = 1000; continue }
  if ([SW]::IsIconic($h)) { Off 'minimised'; continue }
  if (-not $testName -and [SW]::IdleMs() -gt 120000) { if (-not $wasIdle) { $wasIdle = $true; Write-Output '{"idle":true}' }; Off 'idle'; continue }
  if ($wasIdle) { $wasIdle = $false; Write-Output '{"awake":true}' }
  # An app installed from the browser (Instagram, WhatsApp, YouTube as a window of their own) runs as the browser's
  # own process, but it is an app, not a browser: it has no address bar. Looked for once per window.
  if ($h -ne $appCheckFor) {
    $appCheckFor = $h; $isApp = $false
    if (@('chrome', 'msedge', 'brave') -contains $fname) {
      try { $isApp = -not $A::FromHandle($h).FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'OmniboxViewViews'))) } catch { $isApp = $false }
    }
  }
  if ($isApp) { Off 'an app, not a browser'; $pause = 1000; continue }

  $url = $null; $r = $null; $doc = $null
  # Finding the page means walking the whole browser window, page included. The page in front only changes with
  # the tab or the title (or on navigation, when the old element stops answering), so the last one is reused for a
  # few seconds when neither changed.
  $title = [SW]::Title($h)
  $tick = [Environment]::TickCount
  $reuse = $cachedDoc -and $h -eq $cachedFor -and $title -eq $cachedTitle -and ($tick - $cachedAt) -lt 3000
  if ($reuse) { try { if ($cachedDoc.Current.IsOffscreen) { $reuse = $false } } catch { $reuse = $false } }
  if ($reuse) { $doc = $cachedDoc }
  try {
    if (-not $reuse) {
      $root = $A::FromHandle($h)
      # A browser keeps a page for every tab. The one in front is the document that is on screen, with the largest
      # area: the first one found is often a background tab, which kept Sentinel on the first tab.
      $best = $null; $bestArea = 0
      $dscope = $docCache.Activate()
      try { $docs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond) } finally { $dscope.Dispose() }
      foreach ($d in $docs) {
        if ($d.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }
        $dr = $d.GetCachedPropertyValue($A::BoundingRectangleProperty)
        if ([double]::IsInfinity($dr.Width) -or $dr.Width -lt 1) { continue }
        $area = $dr.Width * $dr.Height
        if ($area -gt $bestArea) { $bestArea = $area; $best = $d }
      }
      $doc = $best
      $cachedDoc = $best; $cachedFor = $h; $cachedTitle = $title; $cachedAt = $tick
    }
    if ($doc) { $url = $doc.GetCurrentPattern($VP::Pattern).Current.Value; $r = $doc.Current.BoundingRectangle }
  } catch { $url = $null; $cachedDoc = $null }
  if (-not $url -or -not $r -or [double]::IsInfinity($r.Width) -or $r.Width -lt 200) {
    if ($noDoc -ne $fname) { $noDoc = $fname; Write-Output (@{ browser = $fname; nodoc = $true } | ConvertTo-Json -Compress) }
    Off 'no page'; continue
  }
  $noDoc = ''
  $isPrivate = $title -match $private
  # Over this browser, and only just: anything opened on top of it stays on top of the marks.
  $browserH = $h
  if ($overlayH -ne [IntPtr]::Zero) { [void][SW]::Above($overlayH, $h) }

  $winKey = "$h|$([int]$r.X)|$([int]$r.Y)|$([int]$r.Width)|$([int]$r.Height)|$isPrivate"
  if ($winKey -ne $lastWin) {
    $lastWin = $winKey; $forceRead = $true
    Write-Output (@{ win = @{ browser = $fname; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; private = [bool]$isPrivate } } | ConvertTo-Json -Compress)
  }

  $key = $fname + '|' + $url
  if ($key -ne $last) {
    $last = $key; $lastLinks = ''; $anchor = $null; $forceRead = $true
    Write-Output (@{ browser = $fname; url = $url; private = [bool]$isPrivate; search = [bool]($url -match $search) } | ConvertTo-Json -Compress)
  }

  # Reading every link on a page is the expensive part (hundreds of milliseconds on a slow machine). Read again only
  # when something can have changed: a new page or window position, the page moved, the last read found nothing
  # (still loading), nothing to follow the page by, or a few seconds passed (results that load in as you scroll).
  # Keyboard focus moving (a menu or panel opening in the page, or closing) can cover or uncover results: look again
  # at once, and once more when its opening animation has finished.
  $focusKey = ''
  try { $fe = $A::FocusedElement; if ($fe) { $focusKey = ($fe.GetRuntimeId() -join '.') } } catch { $focusKey = '' }
  if ($focusKey -ne $lastFocus) { $lastFocus = $focusKey; $forceRead = $true; $recheckAt = $tick + 450 }
  if ($recheckAt -and $tick -ge $recheckAt) { $recheckAt = 0; $forceRead = $true }
  $needRead = $forceRead -or $moved -or -not $anchor -or $lastCount -eq 0 -or ($tick - $readAt) -gt 2500
  if ($needRead -and ($url -match $search -or $url -match $mail)) { $forceRead = $false; $readAt = $tick }

  # On a results page: every link on screen, with where it is. Addresses and rectangles only.
  if ($needRead -and $url -match $search) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $found = $null
    $scope = $cache.Activate()
    try { $found = $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $linkCond) } catch { $found = $null } finally { $scope.Dispose() }
    $list = New-Object System.Collections.ArrayList
    $firstEl = $null; $covered = 0; $staleRead = $false; $hitBudget = $sw.ElapsedMilliseconds + 150; $midY = $r.Top + $r.Height / 2
    if ($found) {
      foreach ($l in $found) {
        if ($list.Count -ge 60) { break }
        $u = $l.GetCachedPropertyValue($VP::ValueProperty)
        if (-not ($u -is [string]) -or $u -notmatch '^https?://') { continue }
        if ($l.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }
        $b = $l.GetCachedPropertyValue($A::BoundingRectangleProperty)
        if ([double]::IsInfinity($b.Width) -or $b.Width -lt 40 -or $b.Height -lt 10) { continue }
        if ($b.Bottom -lt $r.Top -or $b.Top -gt $r.Bottom) { continue }
        $item = @{ u = $u; x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height }
        # A covered link still says which result its neighbours belong to; the app leaves that result without a mark.
        if ($sw.ElapsedMilliseconds -lt $hitBudget -and (Covered $l $b)) { $covered++; $item.c = 1; $item.by = $coverHit }
        # The anchor the page's movement is measured by: the link nearest the middle of the page. The first one was
        # often a header link (DuckDuckGo's logo) in a bar that hides and comes back while scrolling, so the anchor
        # moved by itself and threw every mark off.
        elseif (-not $firstEl -or [Math]::Abs($b.Y - $midY) -lt [Math]::Abs($fy - $midY)) { $firstEl = $l; $fx = [int]$b.X; $fy = [int]$b.Y }
        # Google's own redirect (/goto?url=...) hides where a result leads. The address it shows under the result's
        # title is part of the link's name, so the name goes along for those links only.
        # What the results page shows for the link (its title, and on Google the address under it): the page's own
        # words about itself, as the search engine displays them. Google's /goto links hide where they lead; this
        # text is also how that is found (the address Google shows).
        $n = [string]$l.GetCachedPropertyValue($A::NameProperty)
        if ($n) { $item.n = $n.Substring(0, [Math]::Min(400, $n.Length)) }
        [void]$list.Add($item)
      }
    }
    $sw.Stop()
    $lastCount = $list.Count
    # Whether the page can still scroll up and down ("11"; "01" at its top, "10" at its end, "" when it does not say):
    # a wheel turned toward an end the page has reached moves nothing, and the marks must not move either.
    $ends = ''
    try { $sp = $doc.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern).Current; if ($sp.VerticallyScrollable) { $ends = "$([int]($sp.VerticalScrollPercent -gt 0.5))$([int]($sp.VerticalScrollPercent -lt 99.5))" } } catch { $ends = '' }
    $sig = (($list | ForEach-Object { "$($_.u)|$($_.x)|$($_.y)|$($_.c)" }) -join ';') + "|$ends"
    if ($sig -ne $lastLinks) {
      $lastLinks = $sig
      Write-Output (@{ links = @($list); covered = $covered; for = $url; ends = $ends; ms = [int]$sw.ElapsedMilliseconds; wheel = "$([Wheel]::Registered)/$([Wheel]::Seen)/$([Wheel]::Enabled)/$([Wheel]::Msgs)" } | ConvertTo-Json -Compress -Depth 4)
      # New positions: the anchor starts again from here, and the marks from zero movement.
      $anchor = $firstEl; $anchorX = $fx; $anchorY = $fy; $lastDx = 0; $lastDy = 0
      try { [Glide]::Total = 0 } catch { }
      # The band the page is followed by: the left edge of the results' own text (the marks sit to the right of the
      # links, so they are not in it), from the first result down to the bottom of the page.
      $bandX = ($list | Where-Object { -not $_.c } | ForEach-Object { $_.x } | Measure-Object -Minimum).Minimum
      $bandTop = ($list | ForEach-Object { $_.y } | Measure-Object -Minimum).Minimum
      if ($null -ne $bandX -and $null -ne $bandTop) {
        $bx = [int][Math]::Max($r.Left, $bandX); $by = [int][Math]::Max($r.Top, $bandTop - 20)
        try { [Glide]::Region($bx, $by, [int][Math]::Min(160, $r.Right - $bx), [int]($r.Bottom - $by)) } catch { }
      }
    }
    # A heavy page must not make the reader spin: rest at least twice as long as the read took.
    if ($sw.ElapsedMilliseconds * 2 -gt $pause) { $pause = [int][Math]::Min(3000, $sw.ElapsedMilliseconds * 2) }
    # A light page is read more often, so marks arrive sooner and keep up with scrolling.
    elseif ($sw.ElapsedMilliseconds -lt 70) { $pause = 180 }
    # The page was still moving while it was read: read it again soon, once it has settled.
    if ($staleRead) { $forceRead = $true; $pause = [Math]::Min($pause, 150) }
  }

  # In a webmail inbox: the message rows on screen, as the inbox shows them (sender, subject, preview) and where
  # they are. The words are what the inbox already displays; nothing is opened, clicked or marked as read.
  if ($needRead -and $url -match $mail) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $rows = $null
    $scope = $rowCache.Activate()
    try { $rows = $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $rowCond) } catch { $rows = $null } finally { $scope.Dispose() }
    $list = New-Object System.Collections.ArrayList
    $firstEl = $null
    if ($rows) {
      foreach ($row in $rows) {
        if ($list.Count -ge 40) { break }
        if ($row.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }
        $t = [string]$row.GetCachedPropertyValue($A::NameProperty)
        if ($t.Length -lt 20) { continue }
        $b = $row.GetCachedPropertyValue($A::BoundingRectangleProperty)
        if ([double]::IsInfinity($b.Width) -or $b.Width -lt 300 -or $b.Height -lt 16 -or $b.Height -gt 220) { continue }
        if ($b.Bottom -lt $r.Top -or $b.Top -gt $r.Bottom) { continue }
        if (-not $firstEl) { $firstEl = $row; $fx = [int]$b.X; $fy = [int]$b.Y }
        [void]$list.Add(@{ t = $t.Substring(0, [Math]::Min(600, $t.Length)); x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height })
      }
    }
    $sw.Stop()
    $lastCount = $list.Count
    $sig = ($list | ForEach-Object { "$($_.t.Length)|$($_.x)|$($_.y)" }) -join ';'
    if ($sig -ne $lastLinks) {
      $lastLinks = $sig
      # The part of the page where the message list shows: rows scrolled out of it are hidden by the inbox (and
      # reported off screen), so the visible rows span it. Marks outside it are clipped by the overlay.
      $clipTop = [int]::MaxValue; $clipBottom = 0
      foreach ($it in $list) { if ($it.y -lt $clipTop) { $clipTop = $it.y }; if ($it.y + $it.h -gt $clipBottom) { $clipBottom = $it.y + $it.h } }
      $clip = if ($list.Count) { @{ top = $clipTop; bottom = $clipBottom } } else { $null }
      Write-Output (@{ mail = @($list); clip = $clip; for = $url; ms = [int]$sw.ElapsedMilliseconds } | ConvertTo-Json -Compress -Depth 4)
      $anchor = $firstEl; $anchorX = $fx; $anchorY = $fy; $lastDx = 0; $lastDy = 0
    }
    if ($sw.ElapsedMilliseconds * 2 -gt $pause) { $pause = [int][Math]::Min(3000, $sw.ElapsedMilliseconds * 2) }
  }
}
`;

let child = null;
let opts = null;
let state = { active: false, reason: 'Starting', supported: process.platform === 'win32', current: null, window: null, counts: { checked: 0, flagged: 0 } };
const warned = new Map();
const verdicts = new Map();   // url -> { at, fast, mark }
let settleTimer = null;
let restartTimer = null;
// A reader that keeps failing is brought back more and more slowly (3 s doubling up to 5 min), so a machine where it
// cannot run is not made to start PowerShell every few seconds all day. A minute of running resets the pace.
let quickExits = 0;
let retryTimer = null;        // a failed results check, tried again (see checkLinks)
let latestLinks = null;       // the last list of on-screen links, so late verdicts land where the links are now
let seenResults = { for: null, map: new Map() };   // which result each sitelink on this results page belongs to
let pending = new Set();
let linkEpoch = 0;          // one per full read of the links; page movement is reported relative to it

let readerReady = false;
let overlayHandle = '';     // the overlay's window, kept just above the browser by the reader
const queued = [];
const raiseWaiters = [];
function send(line) {
  if (!child || !child.stdin || child.stdin.destroyed) return false;
  if (!readerReady) { queued.push(line); return true; }
  try { child.stdin.write(`${line}\n`); return true; } catch { return false; }
}

/**
 * Bring a browser's window to the front, maximised, using the reader that is already running: no second
 * PowerShell to start, so it happens at once. Resolves true when a window was raised, false when that browser has
 * no window (the caller then opens it), null when there is no reader to ask.
 */
function raise(processName) {
  if (!child || !/^[a-z]{2,20}$/.test(processName)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { const i = raiseWaiters.indexOf(done); if (i >= 0) raiseWaiters.splice(i, 1); resolve(null); }, 6000);
    const done = (ok) => { clearTimeout(timer); resolve(ok); };
    raiseWaiters.push(done);
    if (!send(`raise ${processName}`)) { raiseWaiters.pop(); clearTimeout(timer); resolve(null); }
  });
}

/** The overlay's window handle (a decimal string): the reader keeps it directly above the browser, never above
 * everything, so the browser's menus and other programs' windows cover it the way they cover the browser. */
function keepAbove(handle) {
  if (!/^\d{1,20}$/.test(String(handle || ''))) return;
  overlayHandle = String(handle);
  if (readerReady) send(`above ${overlayHandle}`);
}

function status() { return { ...state, mode: currentMode() }; }
function currentMode() { return opts && opts.mode && opts.mode() === 'delicate' ? 'delicate' : 'fast'; }
function log(text) { if (opts && opts.onLog) opts.onLog(text); }

function setState(active, reason) {
  // Why live scanning is off belongs in the log: "nothing was checked" must always have a reason on file.
  if (!active && reason && reason !== state.reason) log(`not watching: ${reason}`);
  state = { ...state, active, reason };
  if (opts && opts.onChange) opts.onChange(status());
}

function init(options) {
  opts = options;
  quickExits = 0;   // switched on (again): a fresh start, not the tail of an earlier run of failures
  restart();
}

let generation = 0;
async function restart() {
  stop(null, true);
  // Two restarts can overlap (the tray and the app, or two clicks). Only the newest may start a reader,
  // or the older reader would be orphaned: never stopped, and still feeding this module.
  const mine = ++generation;
  if (!state.supported) return setState(false, 'Live scanning is available on Windows');
  if (!opts.enabled()) return setState(false, 'Live scanning is off');
  if (!opts.getToken()) return setState(false, 'Sign in to start live scanning');
  try {
    const me = await opts.api('/api/v1/auth/me');
    if (mine !== generation) return;
    if (!me.plan.features.liveScanning && !me.plan.features.liveFast) return setState(false, 'Live scanning is not part of this plan');
  } catch (err) {
    if (mine !== generation) return;
    if (err.status === 401) return setState(false, 'Sign in to start live scanning');
    // "Will retry" has to be true: a scanner that is still starting answers a minute later.
    restartTimer = setTimeout(() => restart(), 30000);
    return setState(false, 'Sentinel is offline. Trying again shortly.');
  }
  if (mine !== generation) return;
  start();
}

/**
 * The reader is too long for a command line (Windows allows 32,767 characters, and -EncodedCommand more than
 * doubles its size), so it is written to a file and a short loader runs it. The loader carries the file's SHA-256
 * and refuses to run a file that changed after it was written.
 */
function readerLaunch(body, dir) {
  const hash = crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex').toUpperCase();
  const file = path.join(dir, `sentinel-reader-${hash.slice(0, 12)}.ps1`);
  const q = (t) => t.replace(/'/g, "''");
  const loader = [
    `$f = '${q(file)}'`,
    '$s = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)',
    '$h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace(\'-\', \'\')',
    `if ($h -ne '${hash}') { [Console]::Error.WriteLine('the reader file changed after it was written'); exit 3 }`,
    'Invoke-Expression $s'
  ].join('\n');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')];
  return { file, args };
}

function start() {
  const testProcess = opts.testProcess && /^[a-z]{2,20}$/.test(opts.testProcess) ? opts.testProcess : '';
  if (testProcess) log(`TEST MODE: reading ${testProcess} wherever it is, not the window in front`);
  const src = /\$src = @"([\s\S]*?)"@/.exec(SCRIPT)[1];
  const dll = opts.helperDll ? path.join(path.dirname(String(opts.helperDll)), `reader-helper-${crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)}.dll`) : '';
  const helper = dll.replace(/'/g, "''");
  // The end-to-end run (scripts/live-e2e.ps1) serves a stand-in inbox on this computer, since a test desktop cannot
  // sign in to real webmail. Only a page on 127.0.0.1 can be added this way.
  const inboxPort = /^\d{2,5}$/.test(String(process.env.SENTINEL_TEST_INBOX || '')) ? process.env.SENTINEL_TEST_INBOX : '';
  let body = SCRIPT.replace('__TEST_PROCESS__', () => testProcess).replace('__HELPER_DLL__', () => helper);
  if (inboxPort) body = body.replace("$mail = '^https://(", () => `$mail = '^http://127\\.0\\.0\\.1:${inboxPort}/mail/|^https://(`);
  try {
    const { file, args } = readerLaunch(body, opts.helperDll ? path.dirname(String(opts.helperDll)) : os.tmpdir());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    // Readers and helpers from earlier versions are never used again.
    try {
      for (const name of fs.readdirSync(path.dirname(file))) {
        const old = (/^sentinel-reader-[0-9A-F]{12}\.ps1$/.test(name) && name !== path.basename(file))
          || (/^reader-helper-[\w-]+\.dll$/.test(name) && dll && name !== path.basename(dll));
        if (old) try { fs.unlinkSync(path.join(path.dirname(file), name)); } catch { /* still in use: next time */ }
      }
    } catch { /* best effort */ }
    child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    // Below normal priority: reading the browser must never compete with the browser.
    try { require('os').setPriority(child.pid, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
  } catch (err) {
    log(`could not start the reader: ${err.message}`);
    return setState(false, `Live scanning could not start (${err.message})`);
  }
  log('reader started');
  const mine = child;
  const startedAt = Date.now();
  let errText = '';
  child.on('error', (err) => {
    if (child !== mine) return;
    log(`reader failed: ${err.message}`);
  });
  child.stdin.on('error', () => { /* the reader exited; its exit handler takes it from here */ });
  child.stderr.on('data', (c) => { if (errText.length < 600) { errText += c.toString('utf8'); } });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  child.on('exit', (code) => {
    if (child !== mine) return;   // stopped on purpose, or already replaced
    log(`reader exited (${code})${errText ? `: ${errText.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
    child = null;
    setWindow(null);
    if (!state.active) return;
    // Keep watching: the reader is cheap to bring back.
    setState(false, 'Live scanning stopped. Starting it again.');
    quickExits = Date.now() - startedAt > 60000 ? 0 : quickExits + 1;
    restartTimer = setTimeout(() => restart(), Math.min(300000, 3000 * 2 ** Math.max(0, quickExits - 1)));
  });
  setState(true, null);
}

function stop(reason, silent) {
  clearTimeout(settleTimer);
  clearTimeout(retryTimer);
  clearTimeout(restartTimer);
  const old = child;
  child = null;
  readerReady = false;
  queued.length = 0;
  for (const r of raiseWaiters.splice(0)) r(null);
  if (old) { try { old.kill(); } catch { /* gone */ } }
  state.current = null;
  latestLinks = null;
  setWindow(null);
  generation++;
  if (!silent) setState(false, reason || 'Live scanning is off');
}

function setWindow(win) {
  // One line when a browser starts or stops being watched (never for a private window), so the log can answer "is it working?".
  const was = state.window;
  if (win && !win.private && (!was || was.browser !== win.browser)) log(`watching ${win.browser}: page area ${win.w}x${win.h} at ${win.x},${win.y}`);
  if (!win && was && !was.private) log('no browser in front: resting');
  state.window = win;
  if (opts && opts.onWindow) opts.onWindow(win);
}

function onLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.ready) {
    readerReady = true;
    for (const line of queued.splice(0)) send(line);
    if (overlayHandle) send(`above ${overlayHandle}`);   // a restarted reader learns where the overlay is again
    return;
  }
  if (msg.raised || msg.noWindow) { const r = raiseWaiters.shift(); if (r) r(Boolean(msg.raised)); return; }
  if (msg.front) { if (msg.isBrowser) log(`${msg.front} is in front`); return; }
  if (msg.nodoc) { log(`${msg.browser} is in front, but Windows gave no page address (a start page, a dialog over the page, or the browser's accessibility is off)`); return; }
  if (msg.idle) { log('nobody at the keyboard: paused'); return; }
  if (msg.awake) { log('in use again'); return; }
  if ('win' in msg) {
    if (!msg.win) { clearTimeout(settleTimer); state.current = null; latestLinks = null; }
    setWindow(msg.win || null);
    return;
  }
  if (msg.wheelError) { log(`wheel following could not start: ${String(msg.wheelError).slice(0, 200)}`); return; }
  if (typeof msg.wheel === 'number') { if (opts.onWheel && latestLinks) opts.onWheel({ epoch: latestLinks.epoch, delta: msg.wheel, t: msg.t }); return; }
  if (msg.glideError) { log(`page following by pixels could not start: ${String(msg.glideError).slice(0, 200)}`); return; }
  // The page's own pixels moved by dy since the last frame (Glide): the surest word on a scroll, a frame late.
  if (msg.px) { if (opts.onPixels && latestLinks) opts.onPixels({ epoch: latestLinks.epoch, dy: msg.px.dy, t: msg.px.t }); return; }
  if (msg.shift) { if (opts.onShift && latestLinks) opts.onShift({ epoch: latestLinks.epoch, dx: msg.shift.dx, dy: msg.shift.dy, t: msg.shift.t }); return; }
  if (msg.links) return onLinks(msg);
  if (msg.mail) return onMail(msg);
  if (!msg.url) return;

  clearTimeout(settleTimer);
  latestLinks = null;
  if (!/^https?:\/\//i.test(msg.url)) { state.current = null; if (opts.onPage) opts.onPage(null); return; }
  // Sentinel's own pages and the app's server are not "sites".
  if (opts.origin && msg.url.startsWith(opts.origin)) { state.current = null; if (opts.onPage) opts.onPage(null); return; }
  const page = { browser: msg.browser, url: msg.url, private: Boolean(msg.private), search: Boolean(msg.search), at: Date.now() };
  // What a private window shows is never kept, not even in memory the app's window can read.
  state.current = page.private ? { browser: page.browser, url: null, private: true, at: page.at } : page;
  if (opts.onPage) opts.onPage(page);
  settleTimer = setTimeout(() => check(page).catch(() => {}), SETTLE_MS);
}

async function check(page) {
  let host;
  try { host = new URL(page.url).hostname; } catch { return; }
  // A results page is the search engine's own; its links are what matter, and they are checked one by one.
  if (page.search) { if (opts.onVerdict) opts.onVerdict({ page, badge: null, label: 'Search results' }); return; }

  let verdict;
  try {
    let answer;
    ({ verdict, ...answer } = await opts.api('/api/v1/live/visit', { url: page.url, private: page.private, mode: currentMode() }));
    noteMode(answer);
  } catch (err) {
    log(`check failed${page.private ? '' : ` for ${host}`}: ${err.status || ''} ${err.code || err.message}`);
    // Refused, not a hiccup: stop reading the browser altogether. A reader left running would keep asking, and the
    // gold mask would keep saying "scanning" while nothing is checked.
    if (err.status === 401) stop('Sign in to start live scanning');
    else if (err.status === 403) stop('Live scanning is not part of this plan');
    else if (err.code === 'live_hours_exhausted') stop('Live hours for this week are used up');
    return;
  }
  const badge = (verdict && verdict.overall && verdict.overall.badge) || null;
  const label = verdict && verdict.overall ? verdict.overall.label : 'Checked';
  const stillThere = Boolean(state.current) && state.current.at === page.at;
  if (opts.onVerdict && stillThere) opts.onVerdict({ page, badge, label, kind: worstKind(verdict) });
  count(page.private, badge);
  if (opts.onChecked && !page.private) opts.onChecked({ browser: page.browser, url: page.url, host, badge, label, at: Date.now() });
  if (badge !== 'red' && badge !== 'orange') return;
  const last = warned.get(host);
  if (last && Date.now() - last < RECHECK_MS) return;
  warned.set(host, Date.now());
  if (warned.size > 500) warned.clear();
  opts.onThreat({ browser: page.browser, url: page.url, host, verdict, private: page.private });
}

/** What the server actually used. Delicate that is used up (or not in the plan) carries on as fast, and the person is told once. */
function noteMode(answer) {
  const used = answer && answer.mode;
  const fellBack = (answer && answer.fellBack) || null;
  if (!used || (state.usedMode === used && state.fellBack === fellBack)) return;
  state = { ...state, usedMode: used, fellBack, live: answer.live || state.live };
  if (fellBack) log(`delicate scanning is not available (${fellBack}); carrying on in fast mode`);
  if (opts.onChange) opts.onChange(status());
}

/** A running total for the app's Live panel. Numbers only, and a private window adds nothing to them. */
let countTimer = null;
function count(isPrivate, badge) {
  if (isPrivate) return;
  state.counts = { checked: state.counts.checked + 1, flagged: state.counts.flagged + (badge ? 1 : 0) };
  if (countTimer) return;
  countTimer = setTimeout(() => { countTimer = null; if (opts && opts.onChange) opts.onChange(status()); }, 1500);
}

/** Which mask a verdict wears: the threat with the worst badge. */
function worstKind(verdict) {
  const rank = { red: 3, orange: 2, yellow: 1 };
  let best = 'scam';
  let top = 0;
  for (const [kind, t] of Object.entries((verdict && verdict.threats) || {})) {
    const r = rank[t && t.badge] || 0;
    if (r > top) { top = r; best = kind; }
  }
  return best;
}

const ENGINE_HOSTS = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|youtube\.com|bing\.com|microsoft\.com|msn\.com|live\.com|duckduckgo\.com|duck\.ai|brave\.com|yahoo\.com|ecosia\.org|startpage\.com|yandex\.[a-z.]+|mojeek\.com)$/i;

/**
 * Where a search engine's own redirect link really goes. Bing wraps every result in Edge ("bing.com/ck/a?...&u=a1"
 * + the address in base64), Google sometimes ("/url?q="), DuckDuckGo's plain pages too ("/l/?uddg="), Yahoo always
 * (".../RU=<address>/RK="). Unwrapped, the result is checked like any other; left wrapped, it was skipped as the
 * engine's own link, and a Bing results page got no marks at all. Ads ("bing.com/aclk") cannot be unwrapped: they
 * are only a redirect on Bing's side.
 */
// The address Google shows under a result's title ("https://www.paypal.com › cshelp › contact-us"), from the link's
// name. The title before it is the website's own words and could imitate an address, so the last one is taken:
// Google writes that one, from where the link really goes. Shortened parts ("help_login_...") are left out.
function citedAddress(name) {
  const text = String(name || '');
  const cite = /(?:^|\s)(https?:\/\/(?:[a-z0-9-]+\.)+[a-z]{2,63})((?:\s[›>]\s[^\s›>]+)*)/gi;
  let last = null;
  for (let m; (m = cite.exec(text));) last = m;
  if (!last) return null;
  const parts = last[2].split(/\s[›>]\s/).map((p) => p.trim()).filter(Boolean);
  const kept = [];
  for (const p of parts) { if (/\.\.\.|…/.test(p)) break; kept.push(encodeURIComponent(p)); }
  return `${last[1]}/${kept.join('/')}`;
}

function unwrapResult(u, name) {
  const host = u.hostname;
  let target = null;
  try {
    if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === '/goto') target = citedAddress(name);
    else
    if (/(^|\.)bing\.com$/.test(host) && u.pathname === '/ck/a') {
      const v = u.searchParams.get('u') || '';
      if (v.startsWith('a1')) target = Buffer.from(v.slice(2), 'base64url').toString('utf8');
    } else if (/(^|\.)bing\.com$/.test(host) && /^\/(aclk|aclick)$/.test(u.pathname)) {
      // An ad: the advertiser's address, percent-encoded, then base64.
      const v = u.searchParams.get('u') || '';
      if (v) target = decodeURIComponent(Buffer.from(v, 'base64url').toString('utf8'));
    } else if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === '/url') {
      target = u.searchParams.get('q') || u.searchParams.get('url');
    } else if (/(^|\.)google\.[a-z.]+$/.test(host) && /^\/(pagead\/)?aclk$/.test(u.pathname)) {
      target = u.searchParams.get('adurl');
    } else if (/(^|\.)duckduckgo\.com$/.test(host) && u.pathname.startsWith('/l/')) {
      target = u.searchParams.get('uddg');
    } else if (/(^|\.)duckduckgo\.com$/.test(host) && u.pathname === '/y.js') {
      // An ad: the ad network's own link (u3, unwrapped in turn), or at least the advertiser's site.
      let inner = null;
      try { inner = unwrapResult(new URL(u.searchParams.get('u3'))); } catch { /* none */ }
      if (inner) return inner;
      const site = u.searchParams.get('ad_domain');
      if (site && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site)) target = `https://${site}/`;
    } else if (/(^|\.)search\.yahoo\.com$/.test(host)) {
      const m = /\/RU=([^/]+)\//.exec(u.pathname);
      if (m) target = decodeURIComponent(m[1]);
    }
    if (!target) return null;
    const t = new URL(target);
    return t.protocol === 'http:' || t.protocol === 'https:' ? t : null;
  } catch {
    return null;
  }
}

// Pages anyone can publish on the search engines' own domains: checked like any result, never skipped as the
// engine's own links (phishing on Google Sites, Docs and Forms is common).
const USER_PAGES_ON_ENGINES = /^((sites|docs|drive|forms)\.google\.com|forms\.gle|storage\.googleapis\.com|[a-z0-9-]+\.blogspot\.com)$/i;

// Ad-click trackers an ad goes through before the shop: the shop's address rides along in a parameter, sometimes not
// even encoded (DoubleClick Search puts it last, raw, so everything after "ds_dest_url=" is the address).
const TRACKERS = /(^|\.)(clickserve\.dartsearch\.net|ad\.doubleclick\.net|googleadservices\.com|pixel\.everesttech\.net|click\.linksynergy\.com|go\.redirectingat\.com|[a-z0-9-]*\.?genieshopping\.com|ad\.atdmt\.com|clk\.tradedoubler\.com)$/i;
function trackerTarget(u) {
  if (!TRACKERS.test(u.hostname)) return null;
  const raw = /[?&]ds_dest_url=(https?:\/\/.+)$/i.exec(u.href);
  const candidates = raw ? [raw[1]] : [];
  for (const k of ['adurl', 'url', 'murl', 'u', 'dest', 'destination', 'targeturl', 'redirect', 'r']) {
    const v = u.searchParams.get(k);
    if (v) candidates.push(v);
  }
  for (const c of candidates) {
    try { const t = new URL(/^https?%3a/i.test(c) ? decodeURIComponent(c) : c); if (t.protocol === 'https:' || t.protocol === 'http:') return t; } catch { /* next */ }
  }
  return null;
}

const APP_STORES =/^(apps\.apple\.com|play\.google\.com|apps\.microsoft\.com|chromewebstore\.google\.com|microsoftedge\.microsoft\.com|addons\.mozilla\.org)$/i;

// Hosts where every page belongs to someone different: one mark per page there, not one per host.
const SHARED_HOSTS = /(^|\.)(sites\.google\.com|docs\.google\.com|drive\.google\.com|forms\.gle|dropbox\.com|onedrive\.live\.com|1drv\.ms|notion\.site|linktr\.ee|medium\.com|substack\.com|reddit\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|youtube\.com|github\.com|gitlab\.com|t\.me|wixsite\.com|weebly\.com|blogspot\.com)$/i;

/**
 * One mark per search result, beside its main link. A result's sitelinks (PayPal: Login, Sign up, Contact us...)
 * sit close under its title and share its site: they join that result's mark. A citation chip in an AI answer (a
 * small link) joins its site's main link wherever that is. Two separate results from the same site, further apart,
 * each keep their own mark: one marked and one not looked like a mistake. On shared hosts, each page is its own.
 */
const SAME_RESULT_PX = 150;   // links of one site this close together (vertically) belong to one result
const SAME_PAGE_PX = 40;      // a second link to the same page this close under the first is the same result (further
                              // down, it is another result that happens to lead to the same page)
// The site an address belongs to: its last two labels (three under a country's own co., com., org. ...), so a
// result's sitelink on another of its site's hosts (securepayments.paypal.com under paypal.com) joins it.
function siteOf(host) {
  const parts = host.split('.');
  const n = parts.length >= 3 && /^[a-z]{2}$/.test(parts[parts.length - 1]) && /^(co|com|org|net|gov|edu|ac|or|ne|go)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}
// seen: what this results page showed before (a sitelink's page -> its result's page), so a result's sitelinks left on
// screen after its title scrolled away don't each become a result of their own.
function resultLinks(links, pageUrl, seen = new Map()) {
  let pageHost = '';
  try { pageHost = new URL(pageUrl).hostname; } catch { /* keep all */ }
  const brand = pageHost.split('.').slice(-2, -1)[0] || '';   // duckduckgo, bing, google
  const groups = [];   // { key, page, head (x of its first link), link (where the mark goes), left, wide, top, bottom }
  const chips = [];
  const members = [];   // [the link's page, its group]
  for (const l of links) {
    let u;
    try { u = new URL(l.u); } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    const engines = (h) => (h === pageHost || ENGINE_HOSTS.test(h)) && !USER_PAGES_ON_ENGINES.test(h);
    if (engines(u.hostname)) {
      // The engine's own link, unless it is a redirect to a result.
      u = unwrapResult(u, l.n);
      if (!u || engines(u.hostname)) continue;
    }
    const behind = trackerTarget(u);
    if (behind) u = behind;
    // The engine's own app in an app store ("Get the DuckDuckGo browser" in its menu) is its own link too.
    if (APP_STORES.test(u.hostname) && brand && u.href.toLowerCase().includes(brand)) continue;
    const host = u.hostname.replace(/^www\./, '');
    const key = SHARED_HOSTS.test(host) ? `${host}${u.pathname.split('/').slice(0, 3).join('/')}` : siteOf(host);
    const { n: name, by: _by, ...box } = l;   // by is for review only
    // The result's title, as the search engine shows it: what the page says it is (see the scanner's X01 and U24).
    const link = { ...box, u: u.href, ...(name ? { title: String(name).slice(0, 200) } : {}) };
    const page = host + u.pathname.replace(/\/+$/, '') + u.search;
    if ((l.w || 0) < 100 && (l.h || 0) < 24) { chips.push({ key, link }); continue; }
    // A second link to the same page (or a part of it) is the same result. A sitelink sits just under its result,
    // indented or clearly narrower than the result's title. A separate result from the same site starts where the
    // one before it started, with a link about as wide (DuckDuckGo opens each result with a small site-name link,
    // then the title further left; its ads' sitelinks line up with the ad but are much narrower). Height says
    // nothing: DuckDuckGo's sitelinks carry their description and are as tall as a title.
    const x = l.x || 0, w = l.w || 0;
    const near = groups.find((g) => g.key === key && l.y >= g.top && l.y < g.bottom + SAME_RESULT_PX
      && ((g.page === page && l.y <= g.bottom + SAME_PAGE_PX) || (!(Math.abs(x - g.head) < 4 && w >= 0.5 * g.headW) && (x >= g.left + 4 || w < 0.75 * g.wide))));
    if (!near) {
      const g = { key, page, head: x, headW: w, link, cands: [link], left: x, wide: w, top: l.y, bottom: l.y + (l.h || 0) };
      groups.push(g); members.push([page, g]); continue;
    }
    members.push([page, near]);
    if (near.page === page) near.cands.push(link);
    near.left = Math.min(near.left, x);
    near.wide = Math.max(near.wide, w);
    near.bottom = Math.max(near.bottom, l.y + (l.h || 0));
  }
  // The mark goes beside the title: the topmost link to the result's own page that is sized like one (a single
  // line in title type, taller than the address line under it). Not simply the widest: a Bing ad's description is a link too, wider than its
  // title, and the mark landed in the middle of the text. A Google result is one tall link: then the widest.
  for (const g of groups) {
    if (!g.cands || g.cands.length < 2) continue;
    const widest = g.cands.reduce((a, c) => ((c.w || 0) > (a.w || 0) ? c : a));
    const title = g.cands.filter((c) => (c.h || 0) >= 22 && (c.h || 0) <= 34 && (c.w || 0) >= 0.4 * (widest.w || 0)).sort((a, b) => a.y - b.y)[0];
    g.link = title || widest;
  }
  // A group that was part of another result last time, whose title is now off screen, went with that title.
  const heads = new Set(groups.map((g) => g.page));
  for (let i = groups.length - 1; i >= 0; i--) {
    const was = seen.get(groups[i].page);
    if (was && was !== groups[i].page && !heads.has(was)) groups.splice(i, 1);
  }
  for (const [page, g] of members) if (groups.includes(g) && page !== g.page) seen.set(page, g.page);
  // A small link with no bigger link of its site on screen is a result of its own.
  for (const c of chips) if (!groups.some((g) => g.key === c.key)) groups.push({ key: c.key, link: c.link, top: c.link.y, bottom: c.link.y + (c.link.h || 0) });
  // A result whose title is covered (by a menu the page opened, or a bar at the top) gets no mark at all: not one
  // moved onto its sitelinks. In reading order (top to bottom), at most MAX_LINKS.
  return groups.filter((g) => !g.link.c).map((g) => g.link).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, MAX_LINKS);
}

function markFor(url) {
  const hit = verdicts.get(url);
  if (!hit || Date.now() - hit.at >= VERDICT_TTL_MS) return null;
  // Delicate that fell back to fast (used up, or not in the plan) takes fast answers; otherwise they are asked again.
  if (hit.fast && currentMode() === 'delicate' && !state.fellBack) return null;
  return hit.mark;
}

const markKey = (u) => crypto.createHash('sha1').update(u).digest('base64url').slice(0, 12);

function publishMarks() {
  if (!latestLinks || !opts.onMarks) return;
  opts.onMarks({
    for: latestLinks.for,
    epoch: latestLinks.epoch,
    clip: latestLinks.clip || null,
    ends: latestLinks.ends || '',
    checking: latestLinks.links.filter((l) => !markFor(l.u)).length,
    // `k` keeps each mark on its own element in the overlay while results scroll in and out. A hash, so no address
    // reaches the overlay window.
    marks: latestLinks.links.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, k: markKey(l.u), row: l.u.startsWith('mail:'), ...(markFor(l.u) || { pending: true }) }))
  });
}

async function onLinks(msg) {
  const page = state.window ? { private: Boolean(state.window.private) } : { private: false };
  if (seenResults.for !== msg.for) seenResults = { for: msg.for, map: new Map() };
  const links = resultLinks(Array.isArray(msg.links) ? msg.links : [], msg.for, seenResults.map);
  // The end-to-end run on a GitHub desktop (scripts/live-e2e.ps1) asks for what the reader saw; nobody else sets this.
  if (process.env.SENTINEL_LINK_DUMP && !page.private) {
    try { fs.appendFileSync(process.env.SENTINEL_LINK_DUMP, JSON.stringify({ for: msg.for, covered: msg.covered || 0, raw: msg.links, marked: links.map((l) => l.u) }) + '\n'); } catch { /* best effort */ }
  }
  const fresh = !latestLinks || latestLinks.for !== msg.for;
  // A page read while it was still loading has no results yet: say so again when they arrive, or the log reads
  // "0 results" for a page that is fully marked.
  const arrived = !fresh && latestLinks.links.length === 0 && links.length > 0;
  latestLinks = { for: msg.for, links, epoch: ++linkEpoch, ends: /^[01]{2}$/.test(msg.ends) ? msg.ends : '' };
  if ((fresh || arrived) && !page.private) {
    log(`results page: ${links.length} results on screen, read in ${msg.ms} ms${msg.wheel ? ` (wheel ${msg.wheel})` : ''}`);
    state.lastResults = { count: links.length, ms: msg.ms, at: Date.now() };
  }
  publishMarks();   // positions first: marks already known move at once
  await checkLinks(links, page, msg.for);
}

/**
 * Check the results on screen that have no mark yet. A check that fails (the network dropped, the scanner is
 * restarting) is tried again a few seconds later: a results page left still would otherwise never be marked,
 * because nothing on it changes to cause another read.
 */
/**
 * What the results page says about each result, for the scanner to read without opening anything: the title the
 * search engine shows, and what was searched for ("q" on Google, Bing and DuckDuckGo, "p" on Yahoo).
 */
function searchQuery(forUrl) {
  try { const s = new URL(forUrl).searchParams; return String(s.get('q') || s.get('p') || s.get('query') || '').slice(0, 200); } catch { return ''; }
}
function hintsFor(links, urls, forUrl) {
  const query = searchQuery(forUrl);
  const hints = {};
  for (const u of urls) {
    const l = links.find((x) => x.u === u);
    if ((l && l.title) || query) hints[u] = { title: (l && l.title) || '', query };
  }
  return hints;
}

async function checkLinks(links, page, forUrl) {
  clearTimeout(retryTimer);
  const missing = links.map((l) => l.u).filter((u) => !markFor(u) && !pending.has(u));
  if (!missing.length) return;
  missing.forEach((u) => pending.add(u));
  const store = (byUrl, final, fast) => {
    for (const u of missing) {
      const v = byUrl && byUrl[u];
      if (!v) continue;
      const badge = (v.overall && v.overall.badge) || null;
      const first = v.reasons && v.reasons[0];
      verdicts.set(u, { at: Date.now(), fast, mark: { badge, kind: worstKind(v), label: v.overall ? v.overall.label : 'Checked', reason: first ? first.text : '' } });
      if (final) count(page.private, badge);
    }
  };
  try {
    const started = Date.now();
    const mode = currentMode();
    // Delicate is shown in two steps: the quick answer (lists and checklist, a few ms) goes on screen at once, and
    // the researched answer replaces it when it lands. Nobody waits five seconds for a mark.
    if (mode === 'delicate' && !page.private) {
      const quick = await opts.api('/api/v1/live/batch', { urls: missing, private: false, mode, quick: true, hints: hintsFor(links, missing, forUrl) });
      store(quick.byUrl, false, false);   // shown until the researched answer replaces it
      publishMarks();
      log(`results marked: ${missing.length} in ${Date.now() - started} ms (quick pass)`);
    }
    const { byUrl, ...answer } = await opts.api('/api/v1/live/batch', { urls: missing, private: page.private, mode, hints: page.private ? undefined : hintsFor(links, missing, forUrl) });
    noteMode(answer);
    if (!page.private) log(`results checked: ${missing.length} in ${Date.now() - started} ms (${answer.mode || 'fast'})`);
    store(byUrl, true, (answer.mode || mode) !== 'delicate');
    if (verdicts.size > 2000) { for (const k of [...verdicts.keys()].slice(0, 1000)) verdicts.delete(k); }
  } catch (err) {
    log(`results check failed: ${err.status || ''} ${err.code || err.message}`);
    if (err.code === 'live_hours_exhausted') stop('Live hours for this week are used up');
    else if (err.status !== 401 && err.status !== 403) {
      retryTimer = setTimeout(() => {
        if (child && latestLinks && latestLinks.for === forUrl) checkLinks(latestLinks.links, page, forUrl).catch(() => {});
      }, RETRY_MS);
    }
  } finally {
    missing.forEach((u) => pending.delete(u));
  }
  publishMarks();
}

/**
 * One inbox row as the inbox shows it: "unread, PayPal, Your account is limited, 3:45 PM, Dear customer...".
 * The first short part is usually the sender, the next the subject; everything goes in the body as well, so the
 * checks that read wording see all of it.
 */
function mailFromRow(text) {
  const parts = String(text).split(/,\s+/).map((p) => p.trim()).filter((p) => p && !/^(unread|read|starred|important|has attachment|flagged|pinned)$/i.test(p));
  const from = (parts[0] || '').slice(0, 120);
  const subject = (parts[1] || '').slice(0, 300);
  return { from, fromName: from, subject, body: parts.slice(2).join(' ').slice(0, 1500) };
}

const rowKey = (text) => `mail:${require('crypto').createHash('sha1').update(String(text)).digest('hex').slice(0, 20)}`;

/**
 * One entry per message. An inbox can expose a message twice (the row, and a list item inside it): each was checked
 * on its own and got a mark of its own, so one email showed a tick and a mask side by side. Of rows that overlap on
 * screen, the widest (the whole message row) is kept.
 */
function distinctRows(rows) {
  const kept = [];
  for (const r of [...rows].sort((a, b) => b.w - a.w)) {
    const clash = kept.some((k) => Math.min(k.y + k.h, r.y + r.h) - Math.max(k.y, r.y) > Math.min(k.h, r.h) / 2);
    if (!clash) kept.push(r);
  }
  return kept.sort((a, b) => a.y - b.y);
}

async function onMail(msg) {
  const isPrivate = Boolean(state.window && state.window.private);
  const rows = distinctRows((Array.isArray(msg.mail) ? msg.mail : []).map((r) => ({ u: rowKey(r.t), x: r.x, y: r.y, w: r.w, h: r.h, text: r.t })));
  const fresh = !latestLinks || latestLinks.for !== msg.for;
  const clip = msg.clip && Number.isFinite(msg.clip.top) && Number.isFinite(msg.clip.bottom) ? { top: msg.clip.top, bottom: msg.clip.bottom } : null;
  latestLinks = { for: msg.for, links: rows, clip, epoch: ++linkEpoch };
  if (fresh && !isPrivate) log(`inbox: ${rows.length} messages on screen, read in ${msg.ms} ms`);
  publishMarks();
  const missing = rows.filter((r) => !markFor(r.u) && !pending.has(r.u));
  if (!missing.length) return;
  missing.forEach((r) => pending.add(r.u));
  try {
    const { results } = await opts.api('/api/v1/live/email', { preview: true, emails: missing.map((r) => ({ key: r.u, ...mailFromRow(r.text) })) });
    for (const item of results || []) {
      const v = item.verdict;
      if (!v || !item.key) continue;
      const badge = (v.overall && v.overall.badge) || null;
      const first = v.reasons && v.reasons[0];
      verdicts.set(item.key, { at: Date.now(), mark: { badge, kind: worstKind(v), label: v.overall ? v.overall.label : 'Checked', reason: first ? first.text : '' } });
      if (verdicts.size > 2000) { for (const k of [...verdicts.keys()].slice(0, 1000)) verdicts.delete(k); }
      count(isPrivate, badge);
    }
  } catch (err) {
    // Email checks are part of Pro and up: on another plan the inbox is simply left unmarked.
    if (err.status !== 403) log(`inbox check failed: ${err.status || ''} ${err.code || err.message}`);
  } finally {
    missing.forEach((r) => pending.delete(r.u));
  }
  // The end-to-end run's stand-in inbox (see onLinks): what each message got.
  if (process.env.SENTINEL_LINK_DUMP && !isPrivate) {
    const got = rows.map((r) => { const m = markFor(r.u); return { t: r.text.slice(0, 70), y: r.y, badge: m ? m.badge : 'none', label: m ? m.label : '' }; });
    try { fs.appendFileSync(process.env.SENTINEL_LINK_DUMP, JSON.stringify({ for: msg.for, inbox: got }) + '\n'); } catch { /* best effort */ }
  }
  publishMarks();
}

module.exports = { init, restart, stop, status, raise, keepAbove, _test: { resultLinks, unwrapResult, worstKind, mailFromRow, distinctRows, readerLaunch, hintsFor, SCRIPT } };
