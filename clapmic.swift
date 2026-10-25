// Mic reader for the clap listener: raw 16 kHz mono signed 16-bit on stdout, like sox `rec`,
// but it survives another app taking the mic (FaceTime, Meet, the Cortex HUD's echo canceller).
// Those switch the mic into a multi-channel voice-processing mode; sox kept its old format and
// read garbage. Here, when the device format changes, the tap is rebuilt for the new format.
import AVFoundation
import Foundation

let engine = AVAudioEngine()
let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
let stdout = FileHandle.standardOutput
signal(SIGPIPE, SIG_DFL)   // node gone -> die

func start() {
    let input = engine.inputNode
    input.removeTap(onBus: 0)
    let inFormat = input.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else { retry(); return }
    let monoIn = AVAudioFormat(standardFormatWithSampleRate: inFormat.sampleRate, channels: 1)!
    guard let conv = AVAudioConverter(from: monoIn, to: outFormat) else { retry(); return }
    input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { buf, _ in
        guard let src = buf.floatChannelData,
              let mono = AVAudioPCMBuffer(pcmFormat: monoIn, frameCapacity: buf.frameLength) else { return }
        mono.frameLength = buf.frameLength
        memcpy(mono.floatChannelData![0], src[0], Int(buf.frameLength) * 4)   // first channel is the mic
        let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / inFormat.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return mono
        }
        let n = Int(out.frameLength)
        if n > 0 { stdout.write(Data(bytes: out.int16ChannelData![0], count: n * 2)) }
    }
    do { try engine.start(); FileHandle.standardError.write("clapmic: \(Int(inFormat.sampleRate)) Hz, \(inFormat.channelCount) ch\n".data(using: .utf8)!) }
    catch { retry() }
}
func retry() { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { engine.stop(); start() } }

// another app switched the mic's mode (or a headset was plugged in): rebuild for the new format
NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { _ in
    engine.stop()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { start() }
}
start()
RunLoop.main.run()
