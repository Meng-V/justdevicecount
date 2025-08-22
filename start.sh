#!/bin/bash

# function start(){
#   /usr/bin/bash /var/www/devicecount/ssh.sh
#   /usr/bin/pm2 stop 0
#   /usr/bin/pm2 start ./bin/www --watch
# }

function start(){
  bash /var/www/devicecount/ssh.sh
  pm2 stop 0
  pm2 start ./bin/www --watch
}

function stop(){
 pm2 stop 0
}

function restart(){
 stop
 start
}

if [ "$1" == "start" ];
then
  start
elif [ "$1" == "stop" ];
then
  stop
elif [ "$1" == "restart" ];
then
  restart
else
  restart
fi
