import pkg from "selfsigned"
import { writeFileSync } from "node:fs"

const attrs = [{ name: "commonName", value: "192.168.0.142" }]
const pems = pkg.generate(attrs, {
  days: 365,
  keySize: 2048,
  algorithm: "sha256",
})

writeFileSync("cert.pem", pems.cert)
writeFileSync("key.pem", pems.private)

console.log("✅ cert.pem and key.pem generated!")