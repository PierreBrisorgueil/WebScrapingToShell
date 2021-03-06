const request = require('request');
const fs = require('fs');
const osmosis = require('osmosis');
const path = require('path');
const _ = require('lodash');

// subprocess
const spawn = require('child_process').spawn;

// utils
const utils = require(path.resolve('./lib/utils.js'));


module.exports = class Parser {
  // constructor
  constructor(task) {
    this.taskName = task;
    this.task = task;
    this.encode = 'utf8';
    this.answer = {
      status: 'ok',
      result: null
    };
  }

  // workflow
  go() {
    this.tasks = this.getJson('tasks.json', 'cant read tasks.json file');
    this.task = this.tasks[this.task];
    this.getSource(this.task.source, function (err, body) {
      if (err) {
        this.answer = { status: 'ko', error: 'can t request ! : ' + err };
      } else {
        this.task.source = body;
        this.task.wrapper = this.generateConfig(this.getJson(this.task.wrapper, 'cant generate osmosis config'));
        this.parse().then(data => {
          this.answer.result = utils.converter(data, this.task.wrapper.model._types);
          this.filter();
          console.log('### Step 1 : ', (JSON.stringify(this.answer, null, 2)));
          this.process();
        });
      }
    }.bind(this));
  }

  // get html data source
  getSource(url, callback) {
    request({
      url: url
    }, (error, response, body) => {
      if (error || response.statusCode !== 200) {
        return callback(error || { statusCode: response.statusCode });
      }
      // console.log(body);
      callback(null, body);
    });
  }

  // get json 
  getJson(file, errorMessage) {
    try {
      const result = JSON.parse(fs.readFileSync(file, this.encode));
      return result;
    } catch (err) {
      if (err.code = 'ENOENT') this.answer = { status: 'ko', error: errorMessage + err };
      else throw err;
      this.writeLog(this.answer);
    }
  }

  // map json config to osmosis config & generate converter config
  generateConfig(config) {
    const deepLoop = (obj) => {
      for (let key in obj) {
        let result = obj[key];
        // if array generate osmosis config
        if (Array.isArray(result) && result[0]._find) {
          for (let i in result) {
            let set;
            result[i] = osmosis
              .find(result[i]._find)
              .set(set = (Object(result[i]._set) === result[i]._set) ? result[i]._set : { value: result[i]._set });
          }
        } else if (Object(result) === result) {
          deepLoop(result);
        }
      }
    };
    deepLoop(config.model._structure);
    return config;
  }

  // parse with osmosis based on conf generated
  parse() {
    return new Promise((resolve, reject) => {
      let results = {};
      osmosis
        .parse(this.task.source)
        // .find('#main-column')
        .set(this.task.wrapper.model._structure)
        .data((data) => results = data)
        .done(() => resolve(results));
    });
  }

  // filter array id asked
  filter() {
    if (this.task.array && this.task.array.name && this.task.array.filters) {
      for (let i in this.task.array.filters) {
        this.answer.result[this.task.array.name] = _.remove(this.answer.result[this.task.array.name], function (obj) {
            if(this.task.array.filters[i]._value) return obj[this.task.array.filters[i]._key] && obj[this.task.array.filters[i]._key].indexOf(this.task.array.filters[i]._value) != -1;
            if(this.task.array.filters[i]._duration) return obj[this.task.array.filters[i]._key] && obj[this.task.array.filters[i]._key] >= this.task.array.filters[i]._duration;
        }.bind(this));
      }
    }
  }

  // execute bash
  process() {

    // execution
    if (this.task.command && this.task.command.shell) {
      let execution = '';

      if (this.task.array && this.task.array.name && this.answer.result.items.length > 0) {
        if (this.task.command.last && this.task.command.shell) {
          execution = this.task.command.shell.replace(/#(\S*)/g, (value) => {
            return this.answer.result[this.task.array.name][0][value.substr(1)];
          });
          this.schell(execution);
        } else {
          for (let i in this.answer.result[this.task.array.name]) {
            execution = this.task.command.shell.replace(/#(\S*)/g, (value) => {
              return this.answer.result[this.task.array.name][i][value.substr(1)];
            });
            this.schell(execution);
          }
          execution.substr(2);
        }
      } 
      
      if (!this.task.array && this.task.command) {
        execution = this.task.command.shell.replace(/#(\S*)/g, (value) => {
          return this.answer.result[value.substr(1)];
        });
        this.schell(execution);
      }
    }
  }

  schell(execution) {
    // if history
    if (this.task.command.history) {
      fs.readFile('./command.log', function (err, data) {
        if (err) {
          this.answer = { status: 'ko', error: 'cant read to the log file ' + err };
          this.writeLog(this.answer);
        } else if (data.indexOf(execution) >= 0) {
          this.writeLog('command already executed : ' + execution);
        } else {

          let _split = execution.split(' ');
          let _command = _split[0];
          _split.shift();

          this.writeLog(execution);

          spawn(_command, _split, {
            stdio: 'ignore',
            detached: true
          }).unref();
        }
      }.bind(this));
    }
  }


  writeLog(string) {
    string = new Date().toLocaleString() + ' - ' + this.taskName + ' - ' + string;
    fs.appendFile('./command.log', '\r\n' + string, function (err) {
      if (err) {
        this.answer = { status: 'ko', error: 'cant write to the log file ' + err };
        this.writeLog(this.answer);
      } else {
        console.log('\r\n ### Step 2 (see bash result in out.log, and history in command.log) :');
        console.log('> ', string);
      }
    }.bind(this));
  }

};
