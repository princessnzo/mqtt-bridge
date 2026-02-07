const mqtt = require('mqtt');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://test.mosquitto.org:1883';
const WS_PORT = process.env.WS_PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Store connected clients and devices
const wsClients = new Set();
const devices = new Map();

// Create HTTP server
const server = http.createServer((req, res) => {
    // Serve static files from public directory
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 
                    'Content-Type': 'text/html',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(content);
            }
        });
    } else if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
    } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            wsClients: wsClients.size,
            devices: devices.size,
            time: new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket Server with proper headers
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: false,
    clientTracking: true,
    handleProtocols: (protocols) => {
        // Handle WebSocket protocols if needed
        return 'mqtt-bridge';
    }
});

// Debug WebSocket server events
wss.on('listening', () => {
    console.log(`🌐 WebSocket server listening on ${HOST}:${WS_PORT}`);
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
});

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    const clientPort = req.socket.remotePort;
    console.log(`🔌 New WebSocket client: ${clientIp}:${clientPort}`);
    
    wsClients.add(ws);
    
    // Send initial device list
    const initialDevices = Array.from(devices.values());
    ws.send(JSON.stringify({
        type: 'INIT',
        devices: initialDevices,
        serverTime: new Date().toISOString(),
        message: 'Connected to MQTT Bridge'
    }));
    
    // Handle messages from frontend
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`📨 From ${clientIp}:`, data.type);
            handleClientMessage(ws, data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            ws.send(JSON.stringify({
                type: 'ERROR',
                message: 'Invalid JSON format'
            }));
        }
    });
    
    // Handle disconnection
    ws.on('close', () => {
        console.log(`🔌 WebSocket client disconnected: ${clientIp}:${clientPort}`);
        wsClients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${clientIp}:`, error);
    });
});

// MQTT Client
console.log(`🔗 Connecting to MQTT broker: ${MQTT_BROKER}`);
const mqttClient = mqtt.connect(MQTT_BROKER, {
    keepalive: 60,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000
});

// Initialize with simulated IoT devices
function initializeDevices() {
    const deviceTypes = ['temperature', 'humidity', 'pressure', 'motion', 'light'];
    
    for (let i = 1; i <= 5; i++) {
        const device = {
            id: `simulated-${i}`,
            type: deviceTypes[i % deviceTypes.length],
            name: `Simulated Sensor ${i}`,
            value: Math.random() * 100,
            connected: true,
            lastUpdate: new Date().toISOString()
        };
        devices.set(device.id, device);
    }
    
    console.log(`📱 Created ${devices.size} simulated devices`);
    return Array.from(devices.values());
}

// MQTT Connection Handler
mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
    
    // Subscribe to all device topics
    mqttClient.subscribe('devices/#', (err) => {
        if (!err) {
            console.log('📡 Subscribed to devices/#');
        } else {
            console.error('❌ Subscription error:', err);
        }
    });
    
    // Initialize simulated devices
    const simulatedDevices = initializeDevices();
    
    // Broadcast simulated devices to WebSocket clients
    broadcastToClients({
        type: 'INIT',
        devices: simulatedDevices
    });
});

// Handle MQTT messages
mqttClient.on('message', (topic, message) => {
    const msgStr = message.toString();
    
    try {
        // Try to parse as JSON first
        const data = JSON.parse(msgStr);
        console.log(`📨 MQTT JSON: ${topic}`);
        
        // Extract device ID from topic (e.g., devices/esp01/get/sensor_data)
        const parts = topic.split('/');
        if (parts.length >= 2 && parts[0] === 'devices') {
            const deviceId = parts[1]; // esp01, ChirpyBird, etc.
            
            // Create or update device
            if (!devices.has(deviceId)) {
                devices.set(deviceId, {
                    id: deviceId,
                    type: 'real',
                    name: `Real Device ${deviceId}`,
                    value: 0,
                    connected: true,
                    lastUpdate: new Date().toISOString(),
                    rawData: data
                });
            } else {
                const device = devices.get(deviceId);
                device.lastUpdate = new Date().toISOString();
                device.rawData = data;
                
                // Extract values if available
                if (data.Temp) device.value = parseFloat(data.Temp);
                if (data.value !== undefined) device.value = data.value;
            }
            
            // Broadcast update
            broadcastToClients({
                type: 'DEVICE_UPDATE',
                device: devices.get(deviceId),
                topic: topic
            });
        }
    } catch (error) {
        // Not JSON, handle as string message
        console.log(`📨 MQTT Text: ${topic} - ${msgStr.substring(0, 50)}...`);
        
        // Still create device entry for non-JSON messages
        const parts = topic.split('/');
        if (parts.length >= 2 && parts[0] === 'devices') {
            const deviceId = parts[1];
            
            if (!devices.has(deviceId)) {
                devices.set(deviceId, {
                    id: deviceId,
                    type: 'real',
                    name: `Real Device ${deviceId}`,
                    value: 0,
                    connected: true,
                    lastUpdate: new Date().toISOString(),
                    lastMessage: msgStr
                });
                
                broadcastToClients({
                    type: 'DEVICE_ADDED',
                    device: devices.get(deviceId)
                });
            }
        }
    }
});

// Publish device updates to MQTT
function publishDeviceUpdate(device) {
    const topic = `devices/${device.id}/status`;
    const payload = JSON.stringify({
        id: device.id,
        type: device.type,
        value: device.value,
        timestamp: new Date().toISOString()
    });
    
    mqttClient.publish(topic, payload, { qos: 1 });
}

// Broadcast to all WebSocket clients
function broadcastToClients(data) {
    const message = JSON.stringify(data);
    let sentCount = 0;
    
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            sentCount++;
        }
    });
    
    if (sentCount > 0) {
        console.log(`📤 Broadcast to ${sentCount} clients: ${data.type}`);
    }
}

// Handle messages from frontend clients
function handleClientMessage(ws, data) {
    switch (data.type) {
        case 'CONTROL_DEVICE':
            if (devices.has(data.deviceId)) {
                const device = devices.get(data.deviceId);
                device.value = data.value;
                device.lastUpdate = new Date().toISOString();
                
                // Publish control command via MQTT
                mqttClient.publish(`devices/${data.deviceId}/control`, JSON.stringify({
                    command: data.command,
                    value: data.value,
                    timestamp: new Date().toISOString()
                }));
                
                // Broadcast update
                broadcastToClients({
                    type: 'DEVICE_UPDATE',
                    device: device
                });
            }
            break;
            
        case 'REQUEST_DEVICE_LIST':
            ws.send(JSON.stringify({
                type: 'DEVICE_LIST',
                devices: Array.from(devices.values()),
                total: devices.size
            }));
            break;
            
        case 'ADD_DEVICE':
            const newDevice = {
                id: `simulated-${devices.size + 1}`,
                type: data.deviceType || 'temperature',
                name: data.deviceName || `New Sensor ${devices.size + 1}`,
                value: Math.random() * 100,
                connected: true,
                lastUpdate: new Date().toISOString()
            };
            
            devices.set(newDevice.id, newDevice);
            publishDeviceUpdate(newDevice);
            
            broadcastToClients({
                type: 'DEVICE_ADDED',
                device: newDevice
            });
            break;
            
        case 'PING':
            ws.send(JSON.stringify({ type: 'PONG', time: Date.now() }));
            break;
    }
}

// Start server
server.listen(WS_PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${WS_PORT}`);
    console.log(`🌍 Web dashboard: http://localhost:${WS_PORT}`);
    console.log(`🔌 WebSocket endpoint: ws://localhost:${WS_PORT}`);
});

// Error handling
mqttClient.on('error', (error) => {
    console.error('❌ MQTT Error:', error);
});

mqttClient.on('offline', () => {
    console.log('📴 MQTT client offline');
});

mqttClient.on('reconnect', () => {
    console.log('🔄 MQTT client reconnecting...');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    mqttClient.end();
    wss.close();
    server.close();
    process.exit(0);
});
