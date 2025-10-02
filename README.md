# JustDeviceCount

A real-time patron counting system for academic libraries and recreational facilities, providing instant visibility into building occupancy across multiple floors.

## 🎯 What Problem Does It Solve?

**Challenge**: Understanding real-time occupancy in multi-floor buildings is difficult without manual counting or expensive specialized hardware.

**Solution**: JustDeviceCount leverages your existing WiFi infrastructure (Cisco CMX) to automatically track unique device counts as a proxy for patron occupancy. The system continuously monitors WiFi-connected devices and provides real-time and historical occupancy data through simple web interfaces.

**Who Benefits**:
- **Library staff**: Monitor patron traffic patterns and optimize staffing
- **Facilities managers**: Track building usage and space utilization
- **Students/visitors**: Check real-time occupancy before visiting
- **Administrators**: Access historical data for planning and reporting

## 📊 Main Features

### Real-Time Occupancy Tracking
Automatically counts unique WiFi devices every 15 minutes across all building floors, providing a reliable estimate of patron counts without requiring manual intervention.

### Multi-Building Support
Simultaneously monitors multiple buildings with different configurations:
- **King Library** (4 floors): Full historical tracking with database storage
- **Recreation Center** (2 floors): Real-time tracking with memory-only storage

### Web Dashboard & APIs
- **Visual Dashboard** (`/crowdindex/`): Interactive web interface showing current occupancy
- **JSON APIs**: Machine-readable endpoints for integration with digital signage, mobile apps, or institutional dashboards

### Historical Analytics
Database storage enables:
- Trend analysis over days, weeks, or months
- Peak usage time identification
- Capacity planning and resource allocation
- Data-driven decision making

## 🌐 Available Routes

All routes are prefixed with `/crowdindex/`

### For End Users

**`GET /crowdindex/`**  
Web dashboard with live occupancy visualization

**`GET /crowdindex/patronapi`**  
King Library current and historical patron data (JSON)

**`GET /crowdindex/recapi`**  
Recreation Center current patron count (JSON)

**`GET /crowdindex/count_by_floor`**  
Floor-by-floor breakdown for both buildings (JSON)

### Example API Response

```json
{
  "currentPatrons": 127,
  "timestamp": "2025-09-30T14:30:00Z",
  "byFloor": {
    "ground": 45,
    "first": 38,
    "second": 28,
    "third": 16
  },
  "historicalAverage": 98,
  "trend": "increasing"
}
```

## 🏗️ How It Works

1. **Data Collection**: Connects to Cisco CMX API every 15 minutes
2. **Device Processing**: Identifies unique WiFi devices and maps them to floor locations
3. **Storage**: Saves historical data to PostgreSQL database (King Library) or keeps in memory (Recreation Center)
4. **Caching**: Maintains 15-minute cache for fast API responses
5. **Delivery**: Serves data via RESTful APIs and web dashboard

## 🔒 Privacy & Security

- **Device Anonymization**: Tracks only anonymized device IDs, never personal information
- **HTTPS Encryption**: All data transmitted over secure SSL/TLS connections
- **No Personal Data**: System cannot identify individuals, only counts unique devices
- **Compliance**: Designed to respect patron privacy while providing occupancy insights

## 💡 Use Cases

### For Library Operations
- Staff allocation based on predicted busy periods
- Study room availability decisions
- Event planning around occupancy patterns

### For Students & Visitors
- Check crowding levels before visiting
- Find quieter study times
- Plan group study sessions

### For Facilities Planning
- Justify space renovations with usage data
- Optimize HVAC and lighting schedules
- Demonstrate ROI for building improvements

## 🛠️ Technical Overview

Built with modern, reliable technology:
- **Backend**: Node.js with Express framework
- **Database**: PostgreSQL with Prisma ORM
- **Process Management**: PM2 for 24/7 uptime
- **Security**: HTTPS/SSL encryption
- **Data Source**: Cisco CMX WiFi Analytics API

## 📖 Documentation

- **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)**: Complete technical guide for local development setup
- **[SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)**: Production server deployment using systemd
- **[TESTING_GUIDE.md](TESTING_GUIDE.md)**: Comprehensive testing procedures

## 🤝 For Peer Institutions

This system is designed to be easily replicated at other universities and institutions with Cisco CMX WiFi infrastructure. The [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) provides step-by-step instructions for deploying at your institution.

## 📞 Getting Support

- **GitHub Issues**: Report bugs or request features
- **Developer Guide**: Technical documentation for deployment
- **Test Suite**: Built-in diagnostics (`npm test`)

---

**Author**: Meng-V  
**License**: ISC  
**Repository**: [GitHub](https://github.com/Meng-V/justdevicecount)
