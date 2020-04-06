const express = require('express')
const open = require('open');
const fs = require('fs');
const readline = require('readline');
const {
  google
} = require('googleapis');
const app = express()
const port = 3000
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';
const apiTimeout = 60 * 1000 * 5;
const NUM_EMAILS = 500;
let gmail;
app.use(express.static('public'))

app.use((req, res, next) => {
    req.setTimeout(apiTimeout, () => {
        let err = new Error('Request Timeout');
        err.status = 408;
        next(err);
    });
    res.setTimeout(apiTimeout, () => {
        let err = new Error('Service Unavailable');
        err.status = 503;
        next(err);
    });
    next();
});

app.get('/api/messages/list', async function (req, res) {
  let messages = await listMessages();
  res.json(compare(messages));
})

fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  authorize(JSON.parse(content), startServer);
});

function authorize(credentials, callback) {
  const {
    client_secret,
    client_id,
    redirect_uris
  } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]);

  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

function startServer(auth) {
  gmail = google.gmail({
    version: 'v1',
    auth
  });
  app.listen(port, () => open('http://localhost:3000'))
}

async function listMessages() {
  const messages = {};
  const params = {
    userId: 'me',
    maxResults: NUM_EMAILS
  };
  const res = await gmail.users.messages.list(params);
  for (const m of res.data.messages) {
    const res = await getMessage(m.id);
    if (res && res.from) {
      if (messages[res.from.name]) {
        messages[res.from.name]['count']++;
      } else {
        messages[res.from.name] = {};
        messages[res.from.name]['last'] = res.snippet;
        messages[res.from.name]['unsubscribe'] = res.unsubscribe;
        messages[res.from.name]['email'] = res.from.email;
        messages[res.from.name]['count'] = 1;
      }
    }
  }
  return messages;
}

function cleanFrom(from) {
  let clean = {};
  clean.email = from.split('<')[1].split('>')[0];
  clean.name = from.split(' <')[0];
  return clean;
}

function cleanUnsubscribe(unsub) {
  let clean;
  unsub = unsub.replace(/\s+/g, '');
  if (unsub.includes('>,<')) {
    let temp1 = unsub.split('>,<')[0].split('<')[1];
    let temp2 = unsub.split('>,<')[1].split('>')[0];
    if (temp1.includes('http'))
      clean = temp1;
    else
      clean = temp2;
  } else if (unsub.includes('http'))
    clean = unsub.split('<')[1].split('>')[0]
  else if (unsub.includes('mailto:'))
    clean = unsub.split('<')[1].split('>')[0]
  return clean;
}

function compare(data) {
  let sorted = {};
  Object
    .keys(data).sort(function(a, b){
        return data[b].count - data[a].count;
    })
    .forEach(function(key) {
        sorted[key] = data[key];
    });
  return sorted;
}

async function getMessage(id) {
  const params = {
    userId: 'me',
    id,
    format: 'metadata'
  };
  let details = {};
  const res = await gmail.users.messages.get(params);
  const headers = res.data.payload.headers;
  const from = headers.find(h => h.name === 'From');
  const snippet = res.data.snippet;
  const unsub = headers.find(h => h.name === 'List-Unsubscribe');

  try {
    details = {
      from: cleanFrom(from.value),
      unsubscribe: cleanUnsubscribe(unsub.value),
      snippet
    }
  } catch (x) {}
  return details;
}