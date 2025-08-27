# Build System Guide

Your JustDeviceCount application now supports generating a production-ready `dist` folder using webpack. This guide explains how to use the new build system.

## Overview

The build system bundles your Node.js application and all its dependencies into a single `dist` folder that can be deployed to production servers. This approach provides:

- **Single artifact deployment**: Everything needed to run the app is in one folder
- **Optimized bundle**: Webpack optimizes the code for production
- **Dependency isolation**: Production dependencies are separate from development tools
- **Easy deployment**: Just copy the `dist` folder to your production server

## Build Commands

### Development Build
```bash
npm run build:dev
```
Creates a development build with source maps and debugging information.

### Production Build
```bash
npm run build
```
Creates an optimized production build.

### Start from Dist
```bash
npm run start:dist
```
Runs the application directly from the `dist` folder (requires build first).

### Complete Build and Deploy Script
```bash
./start-dist.sh
```
Automated script that builds, installs dependencies, and starts with PM2.

## Build Process

The webpack configuration (`webpack.config.js`) performs these steps:

1. **Bundle JavaScript**: Combines all your Node.js modules into `dist/server.js`
2. **Copy Assets**: Copies necessary files and directories:
   - `views/` - EJS templates
   - `config/` - Configuration files
   - `prisma/` - Database schema
   - `security/` - SSL certificates (if present)
   - `package.json` - For production dependencies
   - `.env.example` - Environment template

3. **External Dependencies**: Node modules remain external and are installed separately in the dist folder

## Dist Folder Structure

After building, your `dist` folder will contain:
```
dist/
├── server.js           # Bundled application
├── package.json        # Production dependencies
├── .env.example        # Environment template
├── config/            # Configuration files
├── views/             # EJS templates
├── prisma/            # Database schema
├── security/          # SSL certificates
└── node_modules/      # Production dependencies (after npm install)
```

## Production Deployment

### Method 1: Using the automated script
```bash
./start-dist.sh
```

### Method 2: Manual deployment
```bash
# Build the application
npm run build

# Navigate to dist folder
cd dist

# Install production dependencies
npm install --production

# Copy environment file
cp ../.env .env  # Copy your actual .env file

# Start the application
node server.js
# OR with PM2
pm2 start ../ecosystem.dist.config.js --env production
```

## PM2 Configuration

The build system includes `ecosystem.dist.config.js` for PM2 process management:

- **Process name**: `justdevicecount-dist`
- **Script**: `./dist/server.js`
- **Logs**: Separate log files with `dist-` prefix
- **Environment**: Production-optimized settings

### PM2 Commands for Dist
```bash
npm run pm2:start:dist    # Start from dist folder
pm2 logs justdevicecount-dist  # View logs
pm2 restart justdevicecount-dist  # Restart
pm2 stop justdevicecount-dist     # Stop
```

## Environment Configuration

### SSL Certificates
The application expects SSL certificates for HTTPS. Configure paths using environment variables:

```bash
# For development (default paths)
HTTPS_CERT_PATH=./security/cert.pem
HTTPS_KEY_PATH=./security/cert.key

# For production (override defaults)
PROD_CERT_PATH=/path/to/production/cert.pem
PROD_KEY_PATH=/path/to/production/key.pem
```

### Environment Detection
The application detects the environment based on:
- `NODE_ENV=production` - Forces production mode
- `PRODUCTION_HOSTNAME` - Your production server hostname
- `HOSTNAME` environment variable

## Troubleshooting

### SSL Certificate Errors
If you get certificate errors when testing the dist build:

1. **For testing**: Set `NODE_ENV=development` to use local certificates
2. **For production**: Ensure certificates exist at the specified paths
3. **Override paths**: Use environment variables to specify custom certificate locations

### Missing Dependencies
If modules are missing:
```bash
cd dist
npm install --production
```

### Build Errors
- Check that all source directories exist
- Verify webpack configuration matches your project structure
- Review build output for specific error messages

## Development vs Production

| Aspect | Development | Production (Dist) |
|--------|-------------|-------------------|
| **Files** | Source files | Bundled `server.js` |
| **Dependencies** | All deps | Production only |
| **SSL** | Local certs | Production certs |
| **Environment** | `NODE_ENV=development` | `NODE_ENV=production` |
| **PM2 Config** | `ecosystem.config.js` | `ecosystem.dist.config.js` |

## Integration with Existing Workflow

Your existing development workflow remains unchanged:
- `npm start` - Direct development server
- `npm run dev` - PM2 development mode
- `npm run pm2:start` - PM2 with source files

The new build system adds production deployment options without affecting development.
