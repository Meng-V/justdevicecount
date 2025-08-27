const path = require('path');
const nodeExternals = require('webpack-node-externals');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
  target: 'node',
  entry: './bin/www',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'server.js',
    clean: true
  },
  externals: [nodeExternals()],
  mode: 'production',
  plugins: [
    new CleanWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        // Copy views directory
        {
          from: 'views',
          to: 'views',
          noErrorOnMissing: true
        },
        // Copy public directory
        {
          from: 'public',
          to: 'public',
          noErrorOnMissing: true,
          globOptions: {
            ignore: ['**/.gitkeep']
          }
        },
        // Copy config directory
        {
          from: 'config',
          to: 'config',
          noErrorOnMissing: true
        },
        // Copy prisma directory
        {
          from: 'prisma',
          to: 'prisma',
          noErrorOnMissing: true
        },
        // Copy security directory
        {
          from: 'security',
          to: 'security',
          noErrorOnMissing: true
        },
        // Copy package.json for production dependencies
        {
          from: 'package.json',
          to: 'package.json'
        },
        // Copy .env.example for reference
        {
          from: '.env.example',
          to: '.env.example'
        }
      ]
    })
  ],
  resolve: {
    extensions: ['.js', '.json']
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: {
                  node: '18'
                }
              }]
            ]
          }
        }
      }
    ]
  },
  optimization: {
    minimize: false // Keep code readable for debugging
  }
};
