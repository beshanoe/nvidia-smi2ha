# NVidia Metrics to Home Assistant through MQTT

This project is a Node.js script that sends Nvidia GPU metrics to Home Assistant. It parses the output of the `nvidia-smi` command and uses Home Assistant's MQTT auto-discovery feature to register all GPUs.

## Features
- Sends Nvidia GPU metrics to Home Assistant
- Uses MQTT auto-discovery feature to register all GPUs
- Service file included for systemd

![Home Assistant Screenshot](images/nvidia-smi2ha.jpg)

## Requirements
- Nvidia GPU
- Home Assistant
- MQTT broker
- Node.js (v14 or later recommended)
- `nvidia-smi` command line tool installed and accessible

## Installation
1. Clone the repository to `$HOME/nvidia-stat`
2. Make a copy of the `.env.sample` file as `.env`: `cp .env.sample .env`
3. Edit the credentials for the MQTT connection in `.env`.
4. Register and start the service: `systemctl --user enable $HOME/nvidia-stat/nvidia-smi2ha.service`
5. To start it at logon, make the user "linger": `loginctl enable-linger`
6. Start the service: `systemctl --user start nvidia-smi2ha.service`

## Usage
After installation, the script will start sending GPU metrics to your Home Assistant instance. You can view these metrics in the Home Assistant dashboard.

### Manual Usage
```bash
npm install
npm start
```

## Troubleshooting
If you encounter any issues, please check the following:
- Ensure that the MQTT broker is running and accessible
- Check the `.env` file for any errors in the MQTT credentials
- Ensure Node.js and npm are installed.

## License
This project is licensed under the MIT License.
