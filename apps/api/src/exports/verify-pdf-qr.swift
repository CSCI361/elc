// Local macOS verification only. The Worker never loads Vision or a native library.
import CryptoKit
import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count == 3,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Provide a rendered PDF page and the expected token-hash file.")
}
let expected = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
    .trimmingCharacters(in: .whitespacesAndNewlines)
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(cgImage: image).perform([request])
let observations = request.results ?? []
guard observations.count == 1,
      let payload = observations.first?.payloadStringValue,
      let data = payload.data(using: .utf8),
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["kind"] as? String == "elc_admission",
      json["version"] as? Int == 1,
      let token = json["token"] as? String else {
    fatalError("The rendered page did not decode to one admission credential.")
}
let actual = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
guard actual == expected else { fatalError("The QR does not match the canonical token hash.") }
print("QR decoded successfully and matches the canonical D1 admission token hash.")
