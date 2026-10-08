import Foundation
import ScreenCaptureKit
import CoreMedia
import AVFoundation

let sampleRate = 16000
let stdout = FileHandle.standardOutput
let stderr = FileHandle.standardError

func log(_ s: String) {
    stderr.write((s + "\n").data(using: .utf8)!)
}

final class AudioSink: NSObject, SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        do {
            try sampleBuffer.withAudioBufferList { list, _ in
                guard let buffer = list.first, let data = buffer.mData else { return }
                let count = Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size
                let floats = data.bindMemory(to: Float32.self, capacity: count)
                var out = [Int16](repeating: 0, count: count)
                for i in 0..<count {
                    let v = max(-1, min(1, floats[i]))
                    out[i] = Int16(v * 32767)
                }
                out.withUnsafeBufferPointer { stdout.write(Data(buffer: $0)) }
            }
        } catch {
            log("buffer error: \(error)")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("stopped: \(error.localizedDescription)")
        exit(2)
    }
}

let sink = AudioSink()
var activeStream: SCStream?

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            log("no display")
            exit(1)
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = sampleRate
        config.channelCount = 1
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let stream = SCStream(filter: filter, configuration: config, delegate: sink)
        try stream.addStreamOutput(sink, type: .audio, sampleHandlerQueue: DispatchQueue(label: "cue.audio"))
        try await stream.startCapture()
        activeStream = stream
        log("ready")
    } catch {
        log("error: \(error.localizedDescription)")
        exit(1)
    }
}

signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
RunLoop.main.run()
