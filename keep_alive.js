import express from 'express';

const app = express();
const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 10;

app.get('/', (req, res) => {
  res.send('🤖 Yuta Bot is alive and running!');
});

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

function tryPort(port, attempt = 1) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[KEEP-ALIVE] ✅ Servidor HTTP corriendo en puerto ${port}`);
      console.log(`[KEEP-ALIVE] 🌐 URL: http://localhost:${port}`);
      console.log(`[KEEP-ALIVE] 📊 Configura UptimeRobot para hacer ping a esta URL cada 5 minutos`);
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[KEEP-ALIVE] ⚠️  Puerto ${port} está en uso (intento ${attempt}/${MAX_PORT_ATTEMPTS})`);
        
        if (attempt < MAX_PORT_ATTEMPTS) {
          const nextPort = port + 1;
          console.log(`[KEEP-ALIVE] 🔄 Intentando puerto ${nextPort}...`);
          resolve(tryPort(nextPort, attempt + 1));
        } else {
          console.error(`[KEEP-ALIVE] ❌ No se pudo encontrar un puerto disponible después de ${MAX_PORT_ATTEMPTS} intentos`);
          console.error(`[KEEP-ALIVE] 💡 Solución: Ejecuta "npx kill-port ${DEFAULT_PORT}" o reinicia el sistema`);
          reject(new Error(`No se pudo iniciar el servidor después de ${MAX_PORT_ATTEMPTS} intentos`));
        }
      } else {
        console.error('[KEEP-ALIVE] ❌ Error al iniciar servidor:', err);
        reject(err);
      }
    });
  });
}

export function keepAlive() {
  const startPort = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
  
  console.log(`[KEEP-ALIVE] 🚀 Iniciando servidor HTTP...`);
  
  tryPort(startPort).catch((err) => {
    console.error('[KEEP-ALIVE] ❌ Error fatal al iniciar keep-alive:', err.message);
    console.error('[KEEP-ALIVE] ⚠️  El bot continuará funcionando sin el servidor HTTP');
    console.error('[KEEP-ALIVE] 💡 Para resolver: cierra todos los procesos de Node.js y reinicia');
  });
}
