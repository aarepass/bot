const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CLIENTE_NUMERO = '663386727';

app.use(express.static(path.join(__dirname, 'public')));

let sock;
let qrGlobal = '';
let connectionStatus = 'Desconectado';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrGlobal = qr;
            connectionStatus = 'Esperando escaneo de QR';
            io.emit('status', { status: connectionStatus, qr });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            connectionStatus = 'Desconectado (Reconectando...)';
            io.emit('status', { status: connectionStatus });
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = '¡Conectado a WhatsApp!';
            qrGlobal = '';
            io.emit('status', { status: connectionStatus, qr: null });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const senderJid = m.key.remoteJid;
        const senderNumber = senderJid.split('@')[0];
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text;

        if (!messageText) return;

        io.emit('nuevo-mensaje', {
            sender: senderNumber,
            text: messageText,
            fromMe: false
        });

        const texto = messageText.toLowerCase();
        let respuesta = '';
        
        if (texto.includes('hola') || texto.includes('info') || senderNumber === CLIENTE_NUMERO) {
            respuesta = `🚗🔧 ¡Hola! Bienvenido al **Taller Mecánico Express**. ¿En qué podemos ayudarte hoy?\n\n1️⃣ Cotizar reparación\n2️⃣ Agendar cita\n3️⃣ Horarios y ubicación`;
        } else if (texto.includes('1') || texto.includes('cotizar')) {
            respuesta = '📋 Para darte una cotización aproximada, indícanos:\n- Marca y modelo de tu vehículo\n- Año\n- ¿Qué falla o ruido le escuchas?';
        } else if (texto.includes('2') || texto.includes('cita')) {
            respuesta = '📅 Por favor indícanos qué día y hora te gustaría traer tu auto al taller.';
        } else if (texto.includes('3') || texto.includes('horarios') || texto.includes('ubicacion')) {
            respuesta = '🕒 Horarios: Lunes a Viernes de 8:00 AM a 6:00 PM.\n📍 Ubicación: Av. Principal de Talleres #123.';
        } else {
            respuesta = '🤖 Gracias por escribirnos. Un asesor del taller te responderá en breve. Escribe "1" para cotizar o "2" para agendar cita.';
        }

        await sock.sendMessage(senderJid, { text: respuesta });

        io.emit('nuevo-mensaje', {
            sender: 'Bot Taller',
            text: respuesta,
            fromMe: true
        });
    });
}

io.on('connection', (socket) => {
    socket.emit('status', { status: connectionStatus, qr: qrGlobal });
    socket.emit('set-numero-cliente', CLIENTE_NUMERO);

    socket.on('enviar-mensaje-web', async (data) => {
        const jidDestino = `${CLIENTE_NUMERO}@s.whatsapp.net`;
        if (sock) {
            try {
                await sock.sendMessage(jidDestino, { text: data.text });
                io.emit('nuevo-mensaje', {
                    sender: 'Web (Tú: ' + CLIENTE_NUMERO + ')',
                    text: data.text,
                    fromMe: true
                });
            } catch (e) {
                console.error('Error enviando mensaje desde web:', e);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    connectToWhatsApp();
});