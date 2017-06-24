// This allows the server to use a self-signed certificate.
// It's necessary for old versions of nodejs like on Raspberry PI
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

process.chdir(__dirname);

var ground;

module.exports = {
  background: function (servicehomedir) {
    background(servicehomedir);
  },
  foreground: function (token,userid,computerid) {
    foreground(token,userid,computerid);
  },
  getToken: function (email,password,callback) {
    getToken(email,password,callback);
  },
  cmdFileUpdated: function () {
    cmdFileUpdated();
  },
  computerExists: function (token,computerid,callback) {
    computerExists(token,computerid,callback);
  },
  createComputer: function (token,userid,callback) {
    createComputer(token,userid,callback);
  },
  initFiles: function (path, callback) {
    initFiles(path, callback);
  },
  tokenLogin: function (token,callback) {
    tokenLogin(token,callback);
  },
  triggerCmd: function (token,computername,triggername,callback) {
    triggerCmd(token,computername,triggername,callback);
  }

};

var socketIOClient = require('socket.io-client');
var sailsIOClient = require('sails.io.js');
var cp = require('child_process');
var request = require('request');
var fs = require('fs');
var path = require('path');
// var argv = require('minimist')(process.argv.slice(2));
var prompt = require('prompt');
var os = require('os');

// Set the headers
var headers = {
    'User-Agent':       'TRIGGERcmd/0.1.0',
    'Content-Type':     'application/x-www-form-urlencoded'
}

var daemoninstall;
var installuserhomedir;

var examplefile;
var homedir;
var datapath;
var cmdfile;
var datafile;
exports.datafile = datafile;
var tokenfile;
exports.tokenfile = tokenfile;
var useridfile;
var computeridfile;
exports.computeridfile = computeridfile;
var tokenFromFile;
var computeridFromFile;
var useridFromFile;

function initFiles(backgrounddpath, callback) {
  // var installpath = path.resolve(process.env.LOCALAPPDATA, 'TRIGGERcmdAgent');
  homedir = (process.platform === 'win32') ? process.env.HOMEPATH : process.env.HOME;
  if (!homedir) {homedir = process.env.HOME};
  if (backgrounddpath) {
    datapath = backgrounddpath;
  } else {
    datapath = path.resolve(homedir, ".TRIGGERcmdData");
  }
  if (!fs.existsSync(datapath)){
      fs.mkdirSync(datapath);
  }

  if (process.platform === 'win32') {
    examplefile = 'wincommands.json';
  }
  if (process.platform === 'linux') {
    examplefile = 'linuxcommands.json';
  }
  cmdfile = "commands.json"
  datafile = path.resolve(datapath, cmdfile);
  if (!fs.existsSync(datafile)) {
    fs.createReadStream(examplefile).pipe(fs.createWriteStream(datafile));
  }

  tokenfile = path.resolve(datapath, 'token.tkn');
  useridfile = path.resolve(datapath, 'userid.cfg');
  computeridfile = path.resolve(datapath, 'computerid.cfg');
  tokenFromFile = readMyFile(tokenfile);
  computeridFromFile = readMyFile(computeridfile);
  useridFromFile = readMyFile(useridfile);
  callback(tokenfile, computeridfile, datafile, datapath);
}

// var cafile = path.resolve(__dirname, 'selfsigned.crt');  // dev only
var cafile = path.resolve(__dirname, 'gd_bundle-g2-g1.crt');

// var urlprefix = 'http://localhost:1337'
var urlprefix = 'https://www.triggercmd.com'

// console.log('Connecting to ' + urlprefix);
var options = {
    headers: headers,
    jar: true,
    ca: fs.readFileSync(cafile)
}

if (process.argv[2] == "--daemoninstall") {
  consoleagent(true);
}

if (process.argv[2] == "--console") {
  if (process.platform === 'linux') {
    console.log('Run installdaemon.sh to install the triggercmdagent daemon so it runs during boot');
  }
  consoleagent(false);
}

function consoleagent(daemoninstall) {
  console.log('Daemon install: ' + daemoninstall);
  initFiles(false, function (tfile, cidfile, dfile, dpath) {
    if (!tokenFromFile) {
      console.log('No token exists.  Login to request one.');
      consoleLogin(daemoninstall);
    } else {
      console.log('Logging in with saved token.');
      // console.log(tokenFromFile);
      computerExists(tokenFromFile,computeridFromFile,function(exists){
        if (exists) {
          if (!daemoninstall) {
            foreground(tokenFromFile,useridFromFile,computeridFromFile);
          }
        } else {
          consoleLogin(daemoninstall);
        }
      });
    }
  });
}

function consoleLogin(daemoninstall) {
  var schema = {
    properties: {
      token: {
        required: true
      }
    }
  };

  prompt.start();
  prompt.get(schema, function (err, result) {
    var token = result.token;
    token = token.trim();
    tokenLogin(token, function (token) {
      createComputer(token,useridFromFile, function (computerid) {
        if (!daemoninstall) {
          foreground(token,useridFromFile,computerid);
        }
      });
    });
  });
}

function computerExists(token,computerid,cb) {
  // http://localhost:1337/api/computer/list?computer_id=587a2f04c8f501607e8f9164
  // Configure the request
  console.log('Checking if the ' + computerid + ' computer exists.');

  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/computer/list?computer_id=' + computerid;
  options.method = 'GET';

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      // console.log(JSON.parse(body).records);
      // console.log(JSON.parse(body).records.length);
      if (JSON.parse(body).records.length > 0) {
          console.log('This computer exists in your account.');
          cb(true);
      } else {
          console.log('This computer was deleted from your account.  Login to recreate it.');
          computeridFromFile = null;
          cb(false);
      }
    } else {
      console.log('Error while checking whether computer exists in your account.');
      console.log(error);
      process.exit(1);
    }
  })
}

function background(datapath) {
  ground = 'background';
  initFiles(datapath, function (tfile, cidfile, dfile, dpath) {
    console.log('Tokenfile: ' + tfile);
    console.log('ComputerIDfile: ' + cidfile);
  });

  if (tokenFromFile) {
    console.log('Logging in with saved token to run background tasks.');
    updateCmds(tokenFromFile,useridFromFile,computeridFromFile,true);
  } else {
    console.log('No token.  Exiting background service.');
  }
}

function foreground(token,userid,computerid) {
  ground = 'foreground';
  initFiles(false, function (tfile, cidfile, dfile, dpath) {
    console.log('Tokenfile: ' + tfile);
    console.log('ComputerIDfile: ' + cidfile);
    console.log('Logging in with saved token to run foreground tasks.');
    updateCmds(token,userid,computerid,true);
  });
}

function tokenLogin(token,callback) {
  // Configure the request
  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/command/list';
  options.method = 'GET';

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      // onlinecmds = JSON.parse(body);
      // console.log(onlinecmds);
      // const userid = JSON.parse(body).user.id;
      // writeNewUserIDToFile(userid);
      writeNewTokenToFile(token);
      callback(token);
    } else {
      console.log('Token login failed.');
    }
  })
}

function getToken(email,password,callback) {
  // Configure the request
  var options = {
      url: urlprefix + '/api/auth/authenticate',
      method: 'POST',
      headers: headers,
      jar: true,
      form: {'email': email, 'password': password}
  }

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      const token = JSON.parse(body).token;
      const userid = JSON.parse(body).user.id;
      writeNewUserIDToFile(userid);
      writeNewTokenToFile(token);
      callback(token);
/*
      if (!computeridFromFile) {
        createComputer(token,userid,writeNewTokenToFile(token,callback(token)));
      } else {
        computerExists(token,computeridFromFile,function(exists) {
          if (exists) {
            callback(token);
          } else {
            createComputer(token,userid,writeNewTokenToFile(token,callback(token)));
          }
        });
      }
  */
    } else {
      console.log('Login failed.');
    }
  })
}

function createComputer(token,userid,callback) {
  // console.log('ran createComputer');
  // Configure the request
  var computername = os.hostname();

  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/computer/save';
  options.method = 'POST';
  options.form = {'name': computername};

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var computerid = JSON.parse(body).data.id;
      writeNewComputerIDToFile(token,userid,computerid);
      if (typeof callback === "function") {
        callback(computerid);
      }
    } else {
      console.log('Login failed while trying to create a computer.');
    }
  })
}

function triggerCmd(token,computername,triggername,callback) {
  //  http://localhost:1337/api/run/triggerSave?computername=DS&triggername=Calculator
  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/run/triggerSave';
  options.method = 'POST';
  options.form = {'computername': computername, 'triggername': triggername};

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var message = JSON.parse(body).message;
      if (typeof callback === "function") {
        callback(message);
      }
    } else {
      console.log('Failed while trying to run remote command.');
    }
  })
}

function syncLoop(iterations, process, exit){
    var index = 0,
        done = false,
        shouldExit = false;
    var loop = {
        next:function(){
            if(done){
                if(shouldExit && exit){
                    return exit(); // Exit if we're done
                }
            }
            // If we're not finished
            if(index < iterations){
                index++; // Increment our index
                process(loop); // Run our process, pass in the loop
            // Otherwise we're done
            } else {
                done = true; // Make sure we say we're done
                if(exit) exit(); // Call the callback on exit
            }
        },
        iteration:function(){
            return index - 1; // Return the loop number we're on
        },
        break:function(end){
            done = true; // End the loop
            shouldExit = end; // Passing end as true means we still call the exit callback
        }
    };
    loop.next();
    return loop;
}

function updateCmds(token,userid,computerid,startsocket) {
  // console.log(token + ' u ' + userid + ' c ' + computerid);
  var localcmds = JSON.parse(fs.readFileSync(datafile));
  console.log(localcmds);
  var onlinecmds = [];
  // getOnlineCmds(token,userid,computerid) {
  // Configure the request
  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/command/list?computer_id=' + computerid;
  options.method = 'GET';

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      onlinecmds = JSON.parse(body);

      syncLoop(localcmds.length, function(loop){
        setTimeout(function(){
          var l = loop.iteration();
          // console.log(l);
          var foundonline = false;
          for(var o = 0; o < onlinecmds.records.length; o++)
          {
            // console.log(onlinecmds.records[o].name);
            // console.log(l.toString() + localcmds[l].trigger);
            if (onlinecmds.records[o].name == localcmds[l].trigger &&
                onlinecmds.records[o].voice == localcmds[l].voice
            ) { foundonline = true }
          }
          if (!foundonline) {
            if (localcmds[l].ground == ground) {
              addCmd(localcmds[l].trigger,localcmds[l].voice,token,userid,computerid);
            }
          }
          loop.next();
        }, 10);
      }, function(){
          console.log('Done initiating command adds');
      });

      // Remove any command triggers found online that don't exist in local file anymore.
      // for(var o = 0; o < onlinecmds.records.length; o++)  <- this was too fast
      syncLoop(onlinecmds.records.length, function(loop){
        setTimeout(function(){
          var o = loop.iteration();
          // console.log(o);
          var foundlocal = false;
          for(var l = 0; l < localcmds.length; l++)
          {
            // console.log(onlinecmds.records[o].name);
            // console.log(l.toString() + localcmds[l].trigger);
            if (onlinecmds.records[o].name == localcmds[l].trigger &&
                onlinecmds.records[o].voice == localcmds[l].voice
            ) { foundlocal = true }
          }
          if (!foundlocal) {
            removeCmd(onlinecmds.records[o].name,token,userid,computerid);
          }
          loop.next();
        }, 10);
      }, function(){
          console.log('Done initiating command removals');
      });

    } else {
      console.log('Login failed trying to update command triggers.');
      console.log(error);
      console.log(response);
    }
  })
  if(startsocket) {
    watchForCmdUpdates(token,userid,computerid);
    startSocket(token,computerid);
  }
}

function removeCmd(trigger,token,userid,computerid) {
  // Configure the request

  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/command/delete2';
  options.method = 'POST';
  options.form = {'name': trigger, 'computer': computerid};

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      // var computerid = JSON.parse(body).data.id;
      console.log('Deleted ' + trigger);
    } else {
      console.log('Failed while trying delete a trigger.');
    }
  })
}

function addCmd(trigger,voice,token,userid,computerid) {
  // Configure the request

  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/command/save';
  options.method = 'POST';
  options.form = {'name': trigger, 'computer': computerid, 'voice': voice };

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      // var computerid = JSON.parse(body).data.id;
      console.log('Added ' + trigger);
    } else {
      console.log('Failed while trying add a trigger.');
    }
  })
}

function triggerToCmdObj(cmds, trigger) {
  for(var i = 0; i < cmds.length; i++)
  {
    if(cmds[i].trigger == trigger)
    {
      return cmds[i];
    }
  }
}

function startSocket(token,computerid) {
  var io = sailsIOClient(socketIOClient);
  io.sails.reconnection = true;
  io.sails.url = urlprefix;
  // io.sails.query = 'token=' + token;

  io.sails.transports=['websocket'];

  io.sails.headers = {
    "Authorization": 'Bearer ' + token,
  };

  io.socket.on('message', function(event){
        var trigger = event.trigger;
        var cmdid = event.id;
        //console.log(event);
        console.log(event);
        var commands = JSON.parse(fs.readFileSync(datafile));
        var cmdobj = triggerToCmdObj(commands,trigger);
        if (cmdobj.ground == ground) {
          console.log('Running trigger: ' + trigger + '  Command: ' + cmdobj.command);
          var ChildProcess = cp.exec(cmdobj.command);
          reportBack(token,computerid,cmdid);
        }
  })

  io.socket.get('/api/computer/subscribeToFunRoom?roomName=' + computerid,{Authorization : 'Bearer ' + token},function(data){
         // io.socket.get('/run?status=NotTriggered',{Authorization : 'Bearer ' + token},function(data){
         // io.socket.get('/agent',{access_token : token},function(data){
         console.log(data);
  })

  io.socket.on('connect', function(){
        io.socket.get('/api/computer/subscribeToFunRoom?roomName=' + computerid,{Authorization : 'Bearer ' + token},function(data){
          console.log(data);
        })
  });
}


function reportBack(token,computerid,cmdid) {

  headers.Authorization = 'Bearer ' + token;
  options.headers = headers;
  options.url = urlprefix + '/api/run/save';
  options.method = 'POST';
  options.form = {'status': 'Command ran', 'computer': computerid, 'command': cmdid };

  // Start the request
  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var runid = JSON.parse(body).data.id;
      console.log('Reported: Command Ran');
    } else {
      console.log(error);

      console.log('Failed to report back that the trigger was received.');
    }
  })
}

function cmdFileUpdated() {
  updateCmds(tokenFromFile,useridFromFile,computeridFromFile,false);
}

/*  Replaced to handle smart quote on macs
function watchForCmdUpdates(token,userid,computerid) {
  var chokidar = require('chokidar');

  // One-liner for current directory, ignores .dotfiles
  chokidar.watch(datafile, {ignoreInitial: true}).on('change', function(event, path) {
    console.log(event, path);
    updateCmds(token,userid,computerid,false);
  });
} */

function watchForCmdUpdates(token,userid,computerid) {
  var chokidar = require('chokidar');
  var watcher = chokidar.watch(datafile, {ignoreInitial: true}).on('change', function(event, path) {
    fs.readFile(datafile, 'utf8', function (err,data) {
      if (err) {
        return console.log(err);
      }
      var result = data.replace(/[“”]/g, '\"');
      watcher.close();
      fs.writeFile(datafile, result, 'utf8', function (err) {
         if (err) {
           return console.log(err);
         } else {
           console.log(event, path);
           updateCmds(token,userid,computerid,false);
           watchForCmdUpdates(token,userid,computerid);
         }
      });
    });
  });
}

function writeNewTokenToFile(token) {
  fs.writeFile(tokenfile, token, function(err) {
      if(err) {
          return console.log(err);
      }
      // if (typeof callback === "function") {
      //  callback();
      // }
      console.log("Token saved for next time.");
  });
}

function writeNewUserIDToFile(userid) {
  fs.writeFile(useridfile, userid, function(err) {
      if(err) {
          return console.log(err);
      }

      console.log('User ID ' + userid + ' saved for next time.');
  });
}

function writeNewComputerIDToFile(token,userid,computerid) {
  fs.writeFile(computeridfile, computerid, function(err) {
      if(err) {
          return console.log(err);
      }
      console.log('Computer ID ' + computerid + ' saved for next time.');
      computeridFromFile = computerid;
  });
}

function onErr(err) {
  console.log(err);
  return 1;
}

function readMyFile(file) {
  try {
    return fs.readFileSync(file).toString();
  }
  catch (e) {
    return null;
  }
}