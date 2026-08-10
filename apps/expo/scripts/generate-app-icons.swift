import AppKit
import Foundation

let icons = [
  (name: "green", color: "#035B49", primary: true),
  (name: "teal", color: "#09606B", primary: false),
  (name: "blue", color: "#245493", primary: false),
  (name: "indigo", color: "#414781", primary: false),
  (name: "violet", color: "#66437D", primary: false),
  (name: "rose", color: "#84465F", primary: false),
  (name: "red", color: "#8D403D", primary: false),
  (name: "orange", color: "#925134", primary: false),
  (name: "gold", color: "#80651F", primary: false),
  (name: "black", color: "#292D2C", primary: false),
]

func rgb(from hex: String) -> (red: UInt8, green: UInt8, blue: UInt8) {
  let value = UInt64(hex.dropFirst(), radix: 16)!
  return (
    red: UInt8((value >> 16) & 0xff),
    green: UInt8((value >> 8) & 0xff),
    blue: UInt8(value & 0xff)
  )
}

let expoRoot = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .deletingLastPathComponent()
let alternateDirectory = expoRoot.appendingPathComponent("assets/app-icons")
try FileManager.default.createDirectory(at: alternateDirectory, withIntermediateDirectories: true)

for icon in icons {
  let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 1024,
    pixelsHigh: 1024,
    bitsPerSample: 8,
    samplesPerPixel: 3,
    hasAlpha: false,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 24
  )!
  let color = rgb(from: icon.color)
  let pixels = bitmap.bitmapData!
  for y in 0..<bitmap.pixelsHigh {
    let row = pixels.advanced(by: y * bitmap.bytesPerRow)
    for x in 0..<bitmap.pixelsWide {
      let pixel = row.advanced(by: x * 3)
      pixel[0] = color.red
      pixel[1] = color.green
      pixel[2] = color.blue
    }
  }

  let destination = icon.primary
    ? expoRoot.appendingPathComponent("assets/icon.png")
    : alternateDirectory.appendingPathComponent("\(icon.name).png")
  try bitmap.representation(using: .png, properties: [:])!.write(to: destination)
  print("Rendered \(destination.path)")
}
