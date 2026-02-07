import React, { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import io from 'socket.io-client';
import './App.css';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Types
interface SensorData {
  id: string;
  type: 'temperature' | 'humidity' | 'pressure' | 'vibration';
  value: number;
  unit: string;
  timestamp: string;
  location: string;
}

interface DeviceStatus {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'warning';
  lastSeen: string;
  sensors: string[];
}

const App: React.FC = () => {
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const socketRef = useRef<any>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const socket = io('http://localhost:5001');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to WebSocket server');
      setConnected(true);
    });

    socket.on('sensor-data', (data: SensorData) => {
      setSensorData(prev => {
        const newData = [...prev, data].slice(-50); // Keep last 50 readings
        return newData;
      });
      setMessageCount(prev => prev + 1);
    });

    socket.on('device-status', (data: DeviceStatus[]) => {
      setDevices(data);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Prepare chart data
  const temperatureData = sensorData.filter(d => d.type === 'temperature');
  const humidityData = sensorData.filter(d => d.type === 'humidity');
  const pressureData = sensorData.filter(d => d.type === 'pressure');

  const chartData = {
    labels: temperatureData.slice(-20).map(d => new Date(d.timestamp).toLocaleTimeString()),
    datasets: [
      {
        label: 'Temperature (°C)',
        data: temperatureData.slice(-20).map(d => d.value),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        fill: true,
        tension: 0.4
      },
      {
        label: 'Humidity (%)',
        data: humidityData.slice(-20).map(d => d.value),
        borderColor: 'rgb(54, 162, 235)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        fill: true,
        tension: 0.4
      },
      {
        label: 'Pressure (hPa)',
        data: pressureData.slice(-20).map(d => d.value),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        fill: true,
        tension: 0.4
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Real-time IoT Sensor Data'
      }
    },
    scales: {
      y: {
        beginAtZero: false
      }
    }
  };

  // Send command to device
  const sendCommand = (deviceId: string, command: string) => {
    if (socketRef.current) {
      socketRef.current.emit('device-command', { deviceId, command });
      console.log(`Sent command ${command} to device ${deviceId}`);
    }
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'warning': return 'bg-yellow-500';
      case 'offline': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>🌉 MQTT + WebSocket Bridge</h1>
          <p className="subtitle">Real-time IoT Data Pipeline Demo</p>
          <div className="status-badge">
            <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
            <span className="message-count">
              📨 Messages: {messageCount}
            </span>
            <span className="devices-count">
              📱 Devices: {devices.length}
            </span>
          </div>
        </div>
      </header>

      {/* Main Dashboard */}
      <main className="dashboard">
        {/* Left Column - Devices */}
        <div className="card devices-card">
          <h2>📱 IoT Devices</h2>
          <div className="devices-grid">
            {devices.map(device => (
              <div key={device.id} className="device-card">
                <div className="device-header">
                  <h3>{device.name}</h3>
                  <span className={`status-dot ${getStatusColor(device.status)}`}></span>
                </div>
                <div className="device-details">
                  <p><strong>ID:</strong> {device.id}</p>
                  <p><strong>Status:</strong> {device.status}</p>
                  <p><strong>Last Seen:</strong> {new Date(device.lastSeen).toLocaleTimeString()}</p>
                  <p><strong>Sensors:</strong> {device.sensors.join(', ')}</p>
                </div>
                <div className="device-actions">
                  <button 
                    onClick={() => sendCommand(device.id, 'RESTART')}
                    className="btn btn-warning"
                  >
                    🔄 Restart
                  </button>
                  <button 
                    onClick={() => sendCommand(device.id, 'UPDATE')}
                    className="btn btn-info"
                  >
                    ⬆️ Update
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column - Charts & Data */}
        <div className="card chart-card">
          <h2>📊 Live Sensor Data</h2>
          <div className="chart-container">
            <Line data={chartData} options={chartOptions} />
          </div>
          
          <div className="data-table">
            <h3>Latest Sensor Readings</h3>
            <table>
              <thead>
                <tr>
                  <th>Sensor</th>
                  <th>Value</th>
                  <th>Location</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {sensorData.slice(-10).reverse().map((data, index) => (
                  <tr key={index}>
                    <td>
                      <span className={`sensor-type ${data.type}`}>
                        {data.type === 'temperature' ? '🌡️' : 
                         data.type === 'humidity' ? '💧' : 
                         data.type === 'pressure' ? '📊' : '📳'} 
                        {data.type}
                      </span>
                    </td>
                    <td><strong>{data.value.toFixed(2)} {data.unit}</strong></td>
                    <td>{data.location}</td>
                    <td>{new Date(data.timestamp).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="architecture">
            <h3>🏗️ Architecture</h3>
            <div className="flow-diagram">
              <div className="node">IoT Devices</div>
              <div className="arrow">MQTT →</div>
              <div className="node">WebSocket Bridge</div>
              <div className="arrow">WebSocket →</div>
              <div className="node">React Dashboard</div>
            </div>
          </div>
          <div className="instructions">
            <h4>🚀 Quick Start</h4>
            <code>docker-compose up --build</code>
            <p>Access at: <a href="http://localhost:3000">http://localhost:3000</a></p>
            <p>WebSocket Server: <code>ws://localhost:5001</code></p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
