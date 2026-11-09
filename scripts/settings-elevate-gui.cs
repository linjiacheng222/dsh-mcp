// GUI-subsystem settings writer for dsh-mcp-gateway.
//
// asInvoker, no console. Shows a native Windows Forms trust dialog first:
// shield icon, target file, a diff of pending settings, and explicit
// allow/deny buttons. Only after "allow" does it self-elevate with
// ShellExecuteEx("runas") and write the validated candidate. No PowerShell
// window is created.
//
// Build with scripts/build-elevate.ps1.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("DSH MCP Gateway Settings")]
[assembly: AssemblyDescription("Trusted settings writer for the DSH MCP Gateway plugin")]
[assembly: AssemblyProduct("DSH MCP Gateway")]
[assembly: AssemblyCompany("DeepSeek Harness")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    private const uint SEE_MASK_NOCLOSEPROCESS = 0x00000040;
    private const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellExecuteInfo
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        public string lpVerb;
        public string lpFile;
        public string lpParameters;
        public string lpDirectory;
        public int nShow;
        public IntPtr hInstApp;
        public IntPtr lpIDList;
        public string lpClass;
        public IntPtr hkeyClass;
        public uint dwHotKey;
        public IntPtr hIcon;
        public IntPtr hProcess;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ShellExecuteEx(ref ShellExecuteInfo info);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static int Main(string[] args)
    {
        var positional = new List<string>();
        var confirmed = false;
        foreach (var arg in args ?? new string[0])
        {
            if (string.Equals(arg, "--confirmed", StringComparison.OrdinalIgnoreCase))
            {
                confirmed = true;
            }
            else
            {
                positional.Add(arg);
            }
        }
        if (positional.Count != 2)
        {
            return 2;
        }

        if (IsElevated())
        {
            return WriteSettings(positional[0], positional[1]);
        }

        if (!confirmed && !ShowTrustDialog(positional[0], positional[1]))
        {
            return 1223;
        }
        return RelaunchElevated(positional[0], positional[1]);
    }

    private static bool IsElevated()
    {
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
        {
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
    }

    private static int RelaunchElevated(string source, string target)
    {
        string parameters = Quote(source) + " " + Quote(target) + " --confirmed";
        var info = new ShellExecuteInfo();
        info.cbSize = Marshal.SizeOf(typeof(ShellExecuteInfo));
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = "runas";
        info.lpFile = Assembly.GetExecutingAssembly().Location;
        info.lpParameters = parameters;
        info.lpDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        info.nShow = 0;

        if (!ShellExecuteEx(ref info))
        {
            return Marshal.GetLastWin32Error() == 1223 ? 1223 : 1;
        }
        try
        {
            WaitForSingleObject(info.hProcess, INFINITE);
            uint code;
            return GetExitCodeProcess(info.hProcess, out code) ? unchecked((int)code) : 1;
        }
        finally
        {
            if (info.hProcess != IntPtr.Zero)
            {
                CloseHandle(info.hProcess);
            }
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static string Text(string chinese, string english)
    {
        var language = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        return string.Equals(language, "zh", StringComparison.OrdinalIgnoreCase) ? chinese : english;
    }

    private static bool ShowTrustDialog(string source, string target)
    {
        string details = DescribeChanges(source, target);
        string title = "DSH MCP Gateway";
        string instruction = Text(
            "是否信任 DSH MCP Gateway 修改设置？",
            "Do you trust DSH MCP Gateway to change these settings?");
        string description = Text(
            "DSH MCP Gateway 请求修改受保护的设置文件。\n\n目标文件：\n" + target +
            "\n\n允许后 Windows 会请求管理员权限；只有在你信任本次修改时才继续。",
            "DSH MCP Gateway wants to change its protected settings file.\n\nTarget file:\n" + target +
            "\n\nWindows will request administrator rights after you allow this change. Continue only if you trust it.");
        string changes = Text("修改摘要：\n" + details, "Changes:\n" + details);

        using (var form = new Form())
        {
            form.Text = title;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MaximizeBox = false;
            form.MinimizeBox = false;
            form.ShowInTaskbar = false;
            form.TopMost = true;
            form.ClientSize = new Size(680, 500);
            form.AutoScaleMode = AutoScaleMode.Dpi;

            var layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.ColumnCount = 2;
            layout.RowCount = 1;
            layout.Padding = new Padding(18, 18, 18, 14);
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 58));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            form.Controls.Add(layout);

            var icon = new PictureBox();
            icon.Image = SystemIcons.Shield.ToBitmap();
            icon.SizeMode = PictureBoxSizeMode.AutoSize;
            icon.Margin = new Padding(0, 4, 12, 0);
            layout.Controls.Add(icon, 0, 0);

            var right = new TableLayoutPanel();
            right.Dock = DockStyle.Fill;
            right.ColumnCount = 1;
            right.RowCount = 4;
            right.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            right.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            right.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            right.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.Controls.Add(right, 1, 0);

            var heading = new Label();
            heading.Text = instruction;
            heading.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            heading.AutoSize = true;
            heading.MaximumSize = new Size(575, 0);
            heading.Margin = new Padding(0, 0, 0, 8);
            right.Controls.Add(heading, 0, 0);

            var descriptionLabel = new Label();
            descriptionLabel.Text = description;
            descriptionLabel.Font = new Font("Segoe UI", 9F);
            descriptionLabel.AutoSize = true;
            descriptionLabel.MaximumSize = new Size(575, 0);
            descriptionLabel.Margin = new Padding(0, 0, 0, 10);
            right.Controls.Add(descriptionLabel, 0, 1);

            var detailsBox = new TextBox();
            detailsBox.Text = changes;
            detailsBox.Multiline = true;
            detailsBox.ReadOnly = true;
            detailsBox.ScrollBars = ScrollBars.Vertical;
            detailsBox.Dock = DockStyle.Fill;
            detailsBox.Font = new Font("Consolas", 9F);
            detailsBox.Margin = new Padding(0, 0, 0, 10);
            right.Controls.Add(detailsBox, 0, 2);

            var actions = new FlowLayoutPanel();
            actions.Dock = DockStyle.Fill;
            actions.FlowDirection = FlowDirection.RightToLeft;
            actions.AutoSize = true;
            actions.Margin = new Padding(0);
            right.Controls.Add(actions, 0, 3);

            var allow = new Button();
            allow.Text = Text("信任并请求管理员权限", "Trust and request administrator rights");
            allow.AutoSize = true;
            allow.DialogResult = DialogResult.Yes;
            allow.Margin = new Padding(8, 0, 0, 0);

            var deny = new Button();
            deny.Text = Text("拒绝", "Deny");
            deny.AutoSize = true;
            deny.DialogResult = DialogResult.No;

            actions.Controls.Add(allow);
            actions.Controls.Add(deny);
            form.AcceptButton = deny;
            form.CancelButton = deny;

            return form.ShowDialog() == DialogResult.Yes;
        }
    }

    private static string DescribeChanges(string sourceArg, string targetArg)
    {
        try
        {
            var serializer = new JavaScriptSerializer();
            var source = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(sourceArg, Encoding.UTF8));
            var target = File.Exists(targetArg)
                ? serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(targetArg, Encoding.UTF8))
                : new Dictionary<string, object>();
            var lines = new List<string>();

            AddChanged(lines, "approvalMode", Get(target, "approvalMode"), Get(source, "approvalMode"));
            DictChanges(lines, "capabilities", GetDict(target, "capabilities"), GetDict(source, "capabilities"));
            DictChanges(lines, "scope", GetDict(target, "scope"), GetDict(source, "scope"));
            DictChanges(lines, "limits", GetDict(target, "limits"), GetDict(source, "limits"));

            var oldServer = GetDict(target, "server");
            var newServer = GetDict(source, "server");
            foreach (var key in new[] { "enabled", "allowNonLoopback", "systemApprovalPopup", "instructions" })
            {
                AddChanged(lines, "server." + key, Get(oldServer, key), Get(newServer, key));
            }
            if (!SameValue(Get(oldServer, "token"), Get(newServer, "token")))
            {
                lines.Add("server.token: updated");
            }
            DictChanges(lines, "onboarding", GetDict(target, "onboarding"), GetDict(source, "onboarding"));

            if (lines.Count == 0)
            {
                return Text("无字段变化（仅 revision/updatedAt 更新）", "No field changes (revision/updatedAt only)");
            }
            if (lines.Count > 16)
            {
                lines.RemoveRange(16, lines.Count - 16);
                lines.Add("...");
            }
            return string.Join("\n", lines.ToArray());
        }
        catch
        {
            return Text("无法生成差异摘要；仍将写入已校验的配置文件。", "Could not build a change summary; the validated settings file will still be written.");
        }
    }

    private static Dictionary<string, object> GetDict(Dictionary<string, object> source, string key)
    {
        object value;
        if (source != null && source.TryGetValue(key, out value) && value is Dictionary<string, object>)
        {
            return (Dictionary<string, object>)value;
        }
        return new Dictionary<string, object>();
    }

    private static object Get(Dictionary<string, object> source, string key)
    {
        object value;
        return source != null && source.TryGetValue(key, out value) ? value : null;
    }

    private static bool SameValue(object left, object right)
    {
        if (left == null && right == null) return true;
        if (left == null || right == null) return false;
        return string.Equals(Convert.ToString(left, CultureInfo.InvariantCulture), Convert.ToString(right, CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }

    private static void AddChanged(List<string> lines, string name, object oldValue, object newValue)
    {
        if (!SameValue(oldValue, newValue))
        {
            lines.Add(name + ": " + Display(oldValue) + " -> " + Display(newValue));
        }
    }

    private static void DictChanges(List<string> lines, string prefix, Dictionary<string, object> oldValues, Dictionary<string, object> newValues)
    {
        var keys = new List<string>();
        foreach (var key in oldValues.Keys) if (!keys.Contains(key)) keys.Add(key);
        foreach (var key in newValues.Keys) if (!keys.Contains(key)) keys.Add(key);
        foreach (var key in keys)
        {
            var oldValue = Get(oldValues, key);
            var newValue = Get(newValues, key);
            if (!SameValue(oldValue, newValue))
            {
                lines.Add(prefix + "." + key + ": " + Display(oldValue) + " -> " + Display(newValue));
            }
        }
    }

    private static string Display(object value)
    {
        if (value == null) return "(none)";
        var text = Convert.ToString(value, CultureInfo.InvariantCulture);
        if (text.Length > 120) text = text.Substring(0, 117) + "...";
        return text;
    }

    private static int WriteSettings(string sourceArg, string targetArg)
    {
        string source = Path.GetFullPath(sourceArg);
        string target = Path.GetFullPath(targetArg);

        if (!string.Equals(Path.GetFileName(target), "settings.json", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetFileName(Path.GetDirectoryName(target)), "dsh-mcp-gateway", StringComparison.OrdinalIgnoreCase))
        {
            return 2;
        }
        if (!File.Exists(source))
        {
            return 3;
        }

        string content;
        try
        {
            content = File.ReadAllText(source, Encoding.UTF8);
            var serializer = new JavaScriptSerializer();
            serializer.Deserialize<object>(content);
        }
        catch
        {
            return 4;
        }

        string temporary = target + ".tmp-elevated-" + Guid.NewGuid().ToString("N");
        try
        {
            FileSecurity targetAcl = null;
            if (File.Exists(target))
            {
                try
                {
                    targetAcl = File.GetAccessControl(target);
                }
                catch
                {
                    targetAcl = null;
                }
            }

            File.WriteAllText(temporary, content, new UTF8Encoding(false));
            if (targetAcl != null)
            {
                try
                {
                    File.SetAccessControl(temporary, targetAcl);
                }
                catch
                {
                    // The protected directory ACL is still enforced if the
                    // file-level descriptor cannot be copied.
                }
            }

            if (File.Exists(target))
            {
                File.Replace(temporary, target, null, true);
            }
            else
            {
                File.Move(temporary, target);
            }
            return 0;
        }
        catch
        {
            return 5;
        }
        finally
        {
            try
            {
                if (File.Exists(temporary))
                {
                    File.Delete(temporary);
                }
            }
            catch
            {
                // best effort
            }
        }
    }
}
