import fontBytes from "./assets/NotoSans-Regular.bin"
import { createExportRoutes } from "./routes"

export const exportRoutes = createExportRoutes({
  fontBytes: new Uint8Array(fontBytes),
})
