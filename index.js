const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const readline = require('readline');
const open = require('open');
const fs = require('fs');
const { promisify } = require('util');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = 'token.json';
const LABEL_NAME = 'auto-reply';

async function main() {
  const oAuth2Client = await getOAuth2Client();
  const gmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });

  // start interval to check for new emails and send auto-replies
  setInterval(async () => {
    try {
      const threads = await getUnrepliedThreads(gmailClient);
      for (const thread of threads) {
        const messages = await getMessagesInThread(gmailClient, thread.id);
        if (!hasReplied(messages)) {
          const recipient = getRecipient(messages);
          const message = createAutoReply(recipient);
          const sentMessage = await sendEmail(gmailClient, message);
          await labelEmail(gmailClient, sentMessage.id);
          console.log(`Auto-reply sent to ${recipient}`);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, getRandomInterval());

  console.log('Auto-response app started');
}

async function getOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = JSON.parse(
    await promisify(fs.readFile)('credentials.json')
  ).installed;
  const oAuth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  try {
    const token = await promisify(fs.readFile)(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
  } catch (err) {
    const newToken = await getNewToken(oAuth2Client);
    await promisify(fs.writeFile)(TOKEN_PATH, JSON.stringify(newToken));
    console.log(`Token stored in ${TOKEN_PATH}`);
  }

  return oAuth2Client;
}

async function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log(`Authorize this app by visiting this URL: ${authUrl}`);
  await open(authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise((resolve) => {
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      resolve(code);
    });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  console.log('Token obtained');

  return tokens;
}

async function getUnrepliedThreads(gmailClient) {
  const { data } = await gmailClient.users.threads.list({
    userId: 'me',
    q: `in:inbox -label:${LABEL_NAME} is:unread`,
  });
  return data.threads;
}

async function getMessagesInThread(gmailClient, threadId) {
  const { data } = await gmailClient.users.threads.get({ userId: 'me', id: threadId });
  return data.messages;
}

function hasReplied(messages) {
  return messages.some((message) => message.labelIds.includes(`Label_${LABEL_NAME}`));
}
function getRecipient(message) {
  // Get the 'To' headers from the message payload
  const headers = message.payload.headers.filter(header => header.name === 'To');
  
  // If there are no 'To' headers, the message has no recipient
  if (headers.length === 0) {
    return null;
  }
  
  // Get the email address from the first 'To' header
  const recipient = headers[0].value;
  
  // If the email address is enclosed in angle brackets, remove them
  return recipient.replace(/(^<)|(>$)/g, '');
}
