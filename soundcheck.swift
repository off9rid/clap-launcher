// Which apps are using audio right now? One line per process: "<pid> <mic in 0|1> <sound out 0|1> <name>".
// The clap listener uses it to tell music (sound out only) from a call or a recording (mic in AND sound out).
import CoreAudio
import Darwin

func prop(_ o: AudioObjectID, _ s: AudioObjectPropertySelector) -> UInt32 {
    var a = AudioObjectPropertyAddress(mSelector: s, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var v: UInt32 = 0, n = UInt32(4)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &n, &v) == noErr ? v : 0
}
var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0
let sys = AudioObjectID(kAudioObjectSystemObject)
guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &size) == noErr else { exit(1) }
var ids = [AudioObjectID](repeating: 0, count: Int(size) / 4)
guard AudioObjectGetPropertyData(sys, &a, 0, nil, &size, &ids) == noErr else { exit(1) }
for id in ids {
    let pid = Int32(bitPattern: prop(id, kAudioProcessPropertyPID))
    let i = prop(id, kAudioProcessPropertyIsRunningInput), o = prop(id, kAudioProcessPropertyIsRunningOutput)
    if i == 0 && o == 0 { continue }
    var buf = [CChar](repeating: 0, count: 4096)
    let path = proc_pidpath(pid, &buf, 4096) > 0 ? String(cString: buf) : "?"
    print(pid, i != 0 ? 1 : 0, o != 0 ? 1 : 0, path.split(separator: "/").last.map(String.init) ?? "?")
}
