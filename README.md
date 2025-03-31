![image](https://github.com/user-attachments/assets/d0063c2e-f82f-4181-a72f-e4ce36fea67b)
![image](https://github.com/user-attachments/assets/5ec0da38-65cf-476b-8ac5-6939d636feb3)
![image](https://github.com/user-attachments/assets/2739a495-5748-4481-b4a5-b2a07aebcb7c)
![image](https://github.com/user-attachments/assets/9b0ce04f-7a19-4f28-935b-8512ba5b014a)
![image](https://github.com/user-attachments/assets/5dc951b7-1214-4258-b7d7-2333e6db88d6)

# AI File Analysis Chatbot

This application provides an AI-powered chatbot that can analyze and answer questions about uploaded documents.

## Features

- Upload and analyze PDF and text files
- Ask questions about uploaded documents
- Theme switching (light/dark mode)
- Slack lunch status tracking

## Slack Integration

The chatbot can track whether users in a Slack channel have properly marked their lunch status with #lunchstart and #lunchend tags. This feature helps teams monitor compliance with lunch status reporting.

### Setup Slack Integration

1. Create a Slack app at https://api.slack.com/apps
2. Add the following permissions:
   - `channels:history`
   - `channels:read`
   - `users:read`
3. Install the app to your workspace
4. Copy the Bot Token, App Token, and Signing Secret to your `.env.local` file:
   ```
   SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
   SLACK_APP_TOKEN=xapp-your-slack-app-token
   SLACK_SIGNING_SECRET=your-slack-signing-secret
   ```

### Using the Slack Lunch Status Feature

Simply ask the chatbot about lunch status in your channel:

- "Show lunch status in the general channel"
- "Who hasn't marked their lunch status in team-dev?"
- "Check lunch status for marketing channel from this week"

## Getting Started

1. Clone the repository
2. Copy `.env.local.example` to `.env.local` and fill in your API keys
3. Install dependencies: `npm install` 
4. Run the development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000) in your browser
