// pine-box: pine's helper on Windows. It decides nothing: the daemon says what a command may
// read and write, and this program asks Windows for exactly that.
//
//   pine-box box --name N [--net] [--ledger FILE] [--read DIR]... [--write DIR]... [--deny FILE]... [--objects NAME]... [--cwd DIR] -- PROGRAM ARGS...
//       Runs PROGRAM in an AppContainer named N (made on first use): it reads what Windows lets
//       every app read (the system, Program Files) and what --read and --write name, writes only
//       what --write names, and reaches no network unless --net (and never this computer's own
//       loopback, so not pine's control port). --deny takes writing away from a file that
//       --write would otherwise open (an instruction file after outside content). Every
//       permission this adds to a file or folder is written to --ledger, one line each, so that
//       `ungrant` can take it back. The command and everything it starts are in one job object,
//       which ends them all when this program ends. Its exit code is the command's.
//       --objects makes a folder of named objects in the session's \BaseNamedObjects that the
//       AppContainer may use, for as long as the command runs: the runtime of Git's bash (MSYS)
//       keeps its shared state in one, and an AppContainer may not make one there itself. pine
//       names one that belongs to a copy of that runtime of its own, so that the shell an owner
//       runs outside the sandbox never shares it.
//   pine-box ungrant --ledger FILE
//       Takes back every permission the ledger names, and empties it.
//   pine-box sid --name N
//       Prints the AppContainer's SID (for tests and `pine check`).
//
// Built with the C# compiler of .NET Framework 4, which every Windows 10 and 11 has
// (csc.exe; C# 5: no string interpolation, no expression bodies). src/sandbox-windows.ts builds
// and starts it.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

static class PineBox
{
	const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
	const uint CREATE_SUSPENDED = 0x00000004;
	const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
	const int STARTF_USESTDHANDLES = 0x00000100;
	const int PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
	const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
	const int JobObjectExtendedLimitInformation = 9;
	const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
	const uint INFINITE = 0xFFFFFFFF;
	const int STD_INPUT_HANDLE = -10, STD_OUTPUT_HANDLE = -11, STD_ERROR_HANDLE = -12;
	const uint HANDLE_FLAG_INHERIT = 1;
	const int SE_GROUP_ENABLED = 0x00000004;
	const int HRESULT_ALREADY_EXISTS = unchecked((int)0x800700B7);

	[StructLayout(LayoutKind.Sequential)]
	struct SID_AND_ATTRIBUTES { public IntPtr Sid; public int Attributes; }

	[StructLayout(LayoutKind.Sequential)]
	struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public int CapabilityCount; public int Reserved; }

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	struct STARTUPINFO
	{
		public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
		public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
		public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
	}

	[StructLayout(LayoutKind.Sequential)]
	struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

	[StructLayout(LayoutKind.Sequential)]
	struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

	[StructLayout(LayoutKind.Sequential)]
	struct JOBOBJECT_BASIC_LIMIT_INFORMATION
	{
		public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
		public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
		public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
	}

	[StructLayout(LayoutKind.Sequential)]
	struct IO_COUNTERS { public ulong a, b, c, d, e, f; }

	[StructLayout(LayoutKind.Sequential)]
	struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	{
		public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
		public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
	}

	[DllImport("userenv.dll", CharSet = CharSet.Unicode)]
	static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr caps, int count, out IntPtr sid);
	[DllImport("userenv.dll", CharSet = CharSet.Unicode)]
	static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
	[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);
	[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	static extern bool ConvertStringSidToSid(string text, out IntPtr sid);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
	[DllImport("kernel32.dll")]
	static extern void DeleteProcThreadAttributeList(IntPtr list);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	static extern IntPtr CreateJobObject(IntPtr attrs, string name);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool SetInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int size);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern uint ResumeThread(IntPtr thread);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern uint WaitForSingleObject(IntPtr handle, uint ms);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool GetExitCodeProcess(IntPtr process, out uint code);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool CloseHandle(IntPtr handle);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern IntPtr GetStdHandle(int which);
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
	[DllImport("kernel32.dll")]
	static extern IntPtr LocalFree(IntPtr mem);

	[StructLayout(LayoutKind.Sequential)]
	struct UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }

	[StructLayout(LayoutKind.Sequential)]
	struct OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }

	[DllImport("ntdll.dll")]
	static extern int NtCreateDirectoryObject(out IntPtr handle, uint access, ref OBJECT_ATTRIBUTES attributes);
	[DllImport("kernel32.dll")]
	static extern uint WTSGetActiveConsoleSessionId();
	[DllImport("kernel32.dll", SetLastError = true)]
	static extern bool ProcessIdToSessionId(uint pid, out uint session);
	[DllImport("kernel32.dll")]
	static extern uint GetCurrentProcessId();
	[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, int revision, out IntPtr sd, IntPtr size);

	const uint DIRECTORY_ALL_ACCESS = 0x000F000F;
	const uint OBJ_CASE_INSENSITIVE = 0x40;

	/** A folder of named objects (as the runtime that wants it names it), open to the container and to this user, held while the command runs. */
	static IntPtr ObjectFolder(string full, SecurityIdentifier container)
	{
		// Exactly one new name in the global or this session's namespace of named objects, nothing else.
		if (!System.Text.RegularExpressions.Regex.IsMatch(full, @"^\\(Sessions\\\d+\\)?BaseNamedObjects\\[A-Za-z0-9._-]{1,100}$")) throw new ArgumentException("--objects takes a name like \\BaseNamedObjects\\msys-2.0S5-<key>");
		string me = WindowsIdentity.GetCurrent().User.Value;
		IntPtr sd;
		if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;" + container.Value + ")(A;;GA;;;" + me + ")(A;;GA;;;SY)", 1, out sd, IntPtr.Zero)) throw new Win32Exception();
		var text = new UNICODE_STRING();
		text.Buffer = Marshal.StringToHGlobalUni(full);
		text.Length = (ushort)(full.Length * 2);
		text.MaximumLength = (ushort)(full.Length * 2 + 2);
		IntPtr textPtr = Marshal.AllocHGlobal(Marshal.SizeOf(text));
		Marshal.StructureToPtr(text, textPtr, false);
		var oa = new OBJECT_ATTRIBUTES { Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)), ObjectName = textPtr, Attributes = OBJ_CASE_INSENSITIVE, SecurityDescriptor = sd };
		IntPtr handle;
		int status = NtCreateDirectoryObject(out handle, DIRECTORY_ALL_ACCESS, ref oa);
		// One that is there already belongs to somebody else's shell: it is not opened up to the container.
		if (status != 0) throw new Win32Exception(string.Format("the object folder {0} could not be made (0x{1:X8})", full, status));
		return handle;
	}

	static int Main(string[] argv)
	{
		try
		{
			if (argv.Length == 0) return Usage();
			if (argv[0] == "box") return Box(argv);
			if (argv[0] == "ungrant") return Ungrant(Value(argv, "--ledger"));
			if (argv[0] == "sid") { Console.WriteLine(SidText(Container(Value(argv, "--name")))); return 0; }
			return Usage();
		}
		catch (Exception e)
		{
			Console.Error.WriteLine("pine-box: " + e.Message);
			return 125;
		}
	}

	static int Usage()
	{
		Console.Error.WriteLine("usage: pine-box box --name N [--net] [--ledger F] [--read D]... [--write D]... [--deny F]... [--cwd D] -- PROGRAM ARGS... | ungrant --ledger F | sid --name N");
		return 125;
	}

	static string Value(string[] argv, string name)
	{
		for (int i = 0; i < argv.Length - 1; i++) if (argv[i] == "--") break; else if (argv[i] == name) return argv[i + 1];
		throw new ArgumentException(name + " is missing");
	}

	static List<string> Values(string[] argv, string name)
	{
		var all = new List<string>();
		for (int i = 0; i < argv.Length - 1; i++) { if (argv[i] == "--") break; if (argv[i] == name) all.Add(argv[i + 1]); }
		return all;
	}

	/** The AppContainer of this name: made the first time, the same SID ever after. */
	static IntPtr Container(string name)
	{
		if (name.Length == 0 || name.Length > 64) throw new ArgumentException("an AppContainer name has 1 to 64 characters");
		IntPtr sid;
		int hr = CreateAppContainerProfile(name, name, "pine: commands of an agent", IntPtr.Zero, 0, out sid);
		if (hr == HRESULT_ALREADY_EXISTS) hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
		if (hr != 0) throw new Win32Exception(hr, "the AppContainer " + name + " could not be made (" + hr.ToString("X8") + ")");
		return sid;
	}

	static string SidText(IntPtr sid)
	{
		IntPtr text;
		if (!ConvertSidToStringSid(sid, out text)) throw new Win32Exception();
		string s = Marshal.PtrToStringUni(text);
		LocalFree(text);
		return s;
	}

	/** Gives the container read (and write) on a path, inherited below a folder; notes it in the ledger when it was not there. */
	static void Grant(string path, SecurityIdentifier who, bool write, bool deny, StreamWriter ledger)
	{
		FileSystemRights rights = deny ? (FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.WriteExtendedAttributes | FileSystemRights.WriteAttributes | FileSystemRights.Delete)
			: write ? FileSystemRights.Modify | FileSystemRights.Synchronize : FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize;
		AccessControlType type = deny ? AccessControlType.Deny : AccessControlType.Allow;
		bool folder = Directory.Exists(path);
		if (!folder && !File.Exists(path)) return;
		InheritanceFlags inherit = folder ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
		var rule = new FileSystemAccessRule(who, rights, inherit, PropagationFlags.None, type);
		FileSystemSecurity acl = folder ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
		foreach (FileSystemAccessRule r in acl.GetAccessRules(true, false, typeof(SecurityIdentifier)))
			if (r.IdentityReference.Equals(who) && r.AccessControlType == type && (r.FileSystemRights & rights) == rights && r.InheritanceFlags == inherit) return;
		acl.AddAccessRule(rule);
		if (folder) Directory.SetAccessControl(path, (DirectorySecurity)acl); else File.SetAccessControl(path, (FileSecurity)acl);
		ledger.WriteLine(string.Join("\t", new[] { who.Value, type.ToString(), ((int)rights).ToString(), ((int)inherit).ToString(), path }));
	}

	static int Ungrant(string file)
	{
		if (!File.Exists(file)) return 0;
		foreach (string line in File.ReadAllLines(file))
		{
			string[] f = line.Split('\t');
			if (f.Length != 5) continue;
			try
			{
				var who = new SecurityIdentifier(f[0]);
				var type = (AccessControlType)Enum.Parse(typeof(AccessControlType), f[1]);
				var rule = new FileSystemAccessRule(who, (FileSystemRights)int.Parse(f[2]), (InheritanceFlags)int.Parse(f[3]), PropagationFlags.None, type);
				if (Directory.Exists(f[4])) { var acl = Directory.GetAccessControl(f[4]); acl.RemoveAccessRuleSpecific(rule); Directory.SetAccessControl(f[4], acl); }
				else if (File.Exists(f[4])) { var acl = File.GetAccessControl(f[4]); acl.RemoveAccessRuleSpecific(rule); File.SetAccessControl(f[4], acl); }
			}
			catch (Exception e) { Console.Error.WriteLine("pine-box: " + f[4] + ": " + e.Message); }
		}
		File.WriteAllText(file, "");
		return 0;
	}

	static string Quote(string arg)
	{
		if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
		var b = new StringBuilder("\"");
		int slashes = 0;
		foreach (char c in arg)
		{
			if (c == '\\') { slashes++; continue; }
			if (c == '"') { b.Append('\\', slashes * 2 + 1); b.Append('"'); }
			else { b.Append('\\', slashes); b.Append(c); }
			slashes = 0;
		}
		b.Append('\\', slashes * 2);
		return b.Append('"').ToString();
	}

	static int Box(string[] argv)
	{
		int dash = Array.IndexOf(argv, "--");
		if (dash < 0 || dash == argv.Length - 1) return Usage();
		string name = Value(argv, "--name");
		bool net = Array.IndexOf(argv, "--net") >= 0 && Array.IndexOf(argv, "--net") < dash;
		string cwd = Values(argv, "--cwd").Count > 0 ? Values(argv, "--cwd")[0] : Environment.CurrentDirectory;
		IntPtr sid = Container(name);
		var who = new SecurityIdentifier(SidText(sid));

		var folders = new List<IntPtr>();
		foreach (string o in Values(argv, "--objects")) folders.Add(ObjectFolder(o, who));

		string ledgerFile = Values(argv, "--ledger").Count > 0 ? Values(argv, "--ledger")[0] : Path.Combine(Path.GetTempPath(), "pine-box-" + name + ".ledger");
		using (var ledger = new StreamWriter(ledgerFile, true))
		{
			foreach (string p in Values(argv, "--read")) Grant(p, who, false, false, ledger);
			foreach (string p in Values(argv, "--write")) Grant(p, who, true, false, ledger);
			foreach (string p in Values(argv, "--deny")) Grant(p, who, false, true, ledger);
		}

		// The capabilities that open the network: the internet, and the network at home. The
		// computer's own loopback stays closed to an AppContainer either way.
		var caps = new List<IntPtr>();
		if (net) foreach (string c in new[] { "S-1-15-3-1", "S-1-15-3-3" }) { IntPtr s; if (ConvertStringSidToSid(c, out s)) caps.Add(s); }
		int capSize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
		IntPtr capArray = Marshal.AllocHGlobal(Math.Max(1, caps.Count) * capSize);
		for (int i = 0; i < caps.Count; i++) Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = caps[i], Attributes = SE_GROUP_ENABLED }, capArray + i * capSize, false);
		var sc = new SECURITY_CAPABILITIES { AppContainerSid = sid, Capabilities = caps.Count > 0 ? capArray : IntPtr.Zero, CapabilityCount = caps.Count };
		IntPtr scPtr = Marshal.AllocHGlobal(Marshal.SizeOf(sc));
		Marshal.StructureToPtr(sc, scPtr, false);

		// Only the three standard handles go to the command, whatever else this process holds.
		IntPtr[] std = { GetStdHandle(STD_INPUT_HANDLE), GetStdHandle(STD_OUTPUT_HANDLE), GetStdHandle(STD_ERROR_HANDLE) };
		var handles = new List<IntPtr>();
		foreach (IntPtr h in std) if (h != IntPtr.Zero && h != new IntPtr(-1) && !handles.Contains(h)) { SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT); handles.Add(h); }
		IntPtr handleArray = Marshal.AllocHGlobal(Math.Max(1, handles.Count) * IntPtr.Size);
		for (int i = 0; i < handles.Count; i++) Marshal.WriteIntPtr(handleArray, i * IntPtr.Size, handles[i]);

		IntPtr size = IntPtr.Zero;
		InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
		IntPtr list = Marshal.AllocHGlobal(size);
		if (!InitializeProcThreadAttributeList(list, 2, 0, ref size)) throw new Win32Exception();
		if (!UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, scPtr, (IntPtr)Marshal.SizeOf(sc), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
		if (handles.Count > 0 && !UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleArray, (IntPtr)(handles.Count * IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();

		var si = new STARTUPINFOEX();
		si.StartupInfo.cb = Marshal.SizeOf(si);
		si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
		si.StartupInfo.hStdInput = std[0];
		si.StartupInfo.hStdOutput = std[1];
		si.StartupInfo.hStdError = std[2];
		si.lpAttributeList = list;

		var line = new StringBuilder();
		for (int i = dash + 1; i < argv.Length; i++) { if (line.Length > 0) line.Append(' '); line.Append(Quote(argv[i])); }

		// Git's bash was told not to change the arguments it handed here; the command is not.
		Environment.SetEnvironmentVariable("MSYS2_ARG_CONV_EXCL", null);
		IntPtr job = CreateJobObject(IntPtr.Zero, null);
		var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
		limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
		if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(limits))) throw new Win32Exception();

		PROCESS_INFORMATION pi;
		if (!CreateProcess(null, line, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, IntPtr.Zero, cwd, ref si, out pi))
		{
			int err = Marshal.GetLastWin32Error();
			Console.Error.WriteLine("pine-box: " + argv[dash + 1] + ": " + new Win32Exception(err).Message);
			return err == 2 || err == 3 ? 127 : 126;
		}
		if (!AssignProcessToJobObject(job, pi.hProcess)) throw new Win32Exception();
		ResumeThread(pi.hThread);
		CloseHandle(pi.hThread);
		WaitForSingleObject(pi.hProcess, INFINITE);
		uint code;
		GetExitCodeProcess(pi.hProcess, out code);
		CloseHandle(pi.hProcess);
		DeleteProcThreadAttributeList(list);
		// Closing the job ends what the command left behind, as bwrap --die-with-parent does.
		CloseHandle(job);
		foreach (IntPtr f in folders) CloseHandle(f);
		return (int)code;
	}
}
