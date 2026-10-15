import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], define:{'process.env.BABEL_TYPES_8_BREAKING':'false'}, server:{cors:{origin:[/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,'null']}}, build: { rollupOptions: { input: { studio: 'index.html', preview: 'preview.html' } } } });
