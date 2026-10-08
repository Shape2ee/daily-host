import { Dashboard } from './components/Dashboard/Dashboard';
import {WebSocketProvider} from "./components/WebSocketContext/WebSocketContext.jsx";

function App() {
  return (
    <WebSocketProvider>
      <Dashboard />
    </WebSocketProvider>
  )
}

export default App;
