import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // FastAPI serveert deze map; app/main.py wijst hem aan met DIST_DIR.
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // In dev serveert Vite de pagina en uvicorn de API; alles onder /api
      // gaat naar de backend zodat de frontend dezelfde paden gebruikt als in
      // productie.
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
