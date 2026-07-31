import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Entorno `node`: lo que hay bajo test es lógica de red y de dominio, no componentes.
// Añadir jsdom aquí sería pagar arranque y dependencias por algo que nadie usa todavía.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
