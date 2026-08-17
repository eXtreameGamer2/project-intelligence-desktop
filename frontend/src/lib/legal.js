import { PRODUCT_FLAVOR, PRODUCT_NAME } from './product';

export const LEGAL_EFFECTIVE_DATE = 'August 16, 2026';

export function isLocalProduct() {
  return PRODUCT_FLAVOR === 'local';
}

export function legalMeta() {
  return {
    flavor: PRODUCT_FLAVOR,
    name: PRODUCT_NAME,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
  };
}

function cloudTerms() {
  return {
    title: 'Terms of service',
    sections: [
      {
        heading: '1. What this covers',
        paragraphs: [
          `${PRODUCT_NAME} is a hosted project-intelligence workspace. These terms apply when you create an account, sign in, or use this service.`,
          'This notice describes the product as it works today. It is not legal advice. If you need a contract reviewed for your organization, have a lawyer review it.',
        ],
      },
      {
        heading: '2. Your account',
        paragraphs: [
          'You must provide a working email address and keep your password confidential. You are responsible for activity on your account.',
          'We use a third-party auth provider (Supabase) to create and verify sessions. Sign-out ends your session on this device. There is not currently a self-serve “delete my account” button; you can delete projects and files in the app, and you can ask the operator of this instance to remove an account.',
        ],
      },
      {
        heading: '3. Your content',
        paragraphs: [
          'You own the files and text you upload. You give the operator of this service permission to store and process that material so the product can import it, extract approaches, keep calendars, run discussions, and show dashboards.',
          'Do not upload material you do not have the right to use. Do not use the service to break the law, probe other people’s systems, or harm others.',
        ],
      },
      {
        heading: '4. AI output',
        paragraphs: [
          'Imports, discussions, and suggestions are produced by the AI provider you select (a hosted key, your own key, or a local endpoint). Models can be wrong, incomplete, or cut off. You are responsible for reviewing output before you act on it.',
          'If Improve from past jobs is on, the app may store examples from your work in your project database so later jobs can follow your corrections. That is optional and can be turned off or deleted from Settings.',
        ],
      },
      {
        heading: '5. Sharing',
        paragraphs: [
          'If you create a public roadmap link, anyone with that URL can view the shared project summary. Treat the link as public. Do not share it if the project contains confidential material.',
        ],
      },
      {
        heading: '6. Availability and limits',
        paragraphs: [
          'The service may change, break, or stop. Paid-tier limits and storage depend on how this instance is configured. We do not promise uninterrupted access or that backups will always restore every file.',
        ],
      },
      {
        heading: '7. No warranty; liability',
        paragraphs: [
          'The product is provided as-is. To the extent the law allows, the operator is not liable for decisions you make from AI output, for lost or leaked data caused by a provider you chose, or for indirect damages. Some places do not allow these limits; in those places, the limits apply only as far as the law permits.',
        ],
      },
      {
        heading: '8. Changes',
        paragraphs: [
          `We may update these terms. The effective date at the top of this notice will change when we do. Continued use after an update means you accept the revised terms. The current version is always in Settings and at /terms.`,
        ],
      },
    ],
  };
}

function localTerms() {
  return {
    title: 'Terms of use',
    sections: [
      {
        heading: '1. What this covers',
        paragraphs: [
          `${PRODUCT_NAME} is installed software that runs on your computer. It is not a hosted account service. These terms explain how you may use the app.`,
          'This notice describes the product as it works today. It is not legal advice.',
        ],
      },
      {
        heading: '2. Your data stays with you',
        paragraphs: [
          'Projects, uploads, calendars, and discussions are stored in a local database on this machine. You own that material. Installing the app does not give the publisher a license to your files, and the app does not upload your projects to a Project Intelligence cloud account.',
        ],
      },
      {
        heading: '3. How you may use the app',
        paragraphs: [
          'You may use the app for your own work. Do not use it to break the law. You are responsible for the files you import and for what you send to any AI endpoint you configure.',
        ],
      },
      {
        heading: '4. AI on this computer',
        paragraphs: [
          'The app does not ship a language model. If you connect LM Studio, Ollama, or another local endpoint, file extracts and chat text are sent to that endpoint on this machine (or whatever host you typed). Models can be wrong. Review output before you act on it.',
          'If Improve from past jobs is on, examples from your work may be stored in the local database so later jobs can follow your corrections. You can turn that off or delete those examples in Settings.',
        ],
      },
      {
        heading: '5. Updates',
        paragraphs: [
          'The app can check GitHub for a newer installer and, when installed from a packaged build, download that installer. Checking for updates contacts GitHub, not a Project Intelligence cloud server.',
        ],
      },
      {
        heading: '6. No warranty; liability',
        paragraphs: [
          'The software is provided as-is, without a warranty that it will be error-free or fit for a particular purpose. To the extent the law allows, the publisher is not liable for lost local data, AI mistakes, or decisions you make from the app.',
        ],
      },
      {
        heading: '7. Changes',
        paragraphs: [
          'Later versions may update this notice. The effective date at the top will change when that happens. The current version is always at the bottom of Settings.',
        ],
      },
    ],
  };
}

function cloudPrivacy() {
  return {
    title: 'Privacy notice',
    sections: [
      {
        heading: '1. Who this is for',
        paragraphs: [
          `This notice explains what ${PRODUCT_NAME} stores and what leaves your browser when you use this hosted service. It is a product notice, not a claim that every deployment is certified under a specific privacy law.`,
        ],
      },
      {
        heading: '2. Account data',
        paragraphs: [
          'We store the email address you use to sign up, a password hash managed by Supabase Auth (we do not see your raw password), and session tokens so you can stay signed in.',
        ],
      },
      {
        heading: '3. Project data',
        paragraphs: [
          'We store the files you import, extracted text, approaches, calendars, discussions, saved suggestions, and related settings in the database for this instance.',
          'If Improve from past jobs is on, correction examples and timing samples may also be stored in that database so later jobs can follow your style. You can delete those examples from Settings.',
        ],
      },
      {
        heading: '4. API keys',
        paragraphs: [
          'If you supply your own AI key, it is encrypted in this browser (AES-256-GCM) and kept in local device storage. When you run an AI job, the app sends that key to this instance’s API so the server can call the provider you chose. The key is not used for advertising.',
          'If you use the hosted OpenAI option, prompts and file extracts go to that provider with the operator’s key. That provider has its own privacy policy.',
        ],
      },
      {
        heading: '5. Browser storage',
        paragraphs: [
          'The app uses local storage, session storage, and IndexedDB for encrypted keys, UI preferences (such as the active project), and short-lived flags. These stay on your device unless you clear site data.',
          'Auth uses cookies or similar session storage from the auth provider. Those are needed to sign in. This app does not use advertising cookies or third-party analytics beacons.',
        ],
      },
      {
        heading: '6. Sharing and public pages',
        paragraphs: [
          'A roadmap share link exposes the shared project summary to anyone who opens it. Do not create a share link for confidential work unless you intend that.',
        ],
      },
      {
        heading: '7. Who else can see data',
        paragraphs: [
          'Supabase (auth and, when configured, the hosted database) processes account and project data for this instance.',
          'The AI provider you select receives the prompts and file extracts needed for that job. A local endpoint you configure receives that material at the address you set.',
          'The operator of this instance can access stored project data as needed to run the service. We do not sell your project files.',
        ],
      },
      {
        heading: '8. Retention and your choices',
        paragraphs: [
          'Project data remains until you delete the project, file, or training examples in the app, or until the operator removes the account or database.',
          'You can sign out at any time. You can remove a saved AI key from Settings. For a full account erasure, contact the operator of this instance; self-serve account deletion is not in the app yet.',
        ],
      },
    ],
  };
}

function localPrivacy() {
  return {
    title: 'Privacy notice',
    sections: [
      {
        heading: '1. Who this is for',
        paragraphs: [
          `${PRODUCT_NAME} runs on your computer. This notice explains what stays on the device and what the app may send somewhere else. It is a product notice, not a claim of certification under a specific privacy law.`,
        ],
      },
      {
        heading: '2. What stays on this computer',
        paragraphs: [
          'Projects, uploads, calendars, discussions, and Improve from past jobs examples (if that setting is on) are stored in a local SQLite database and local folders on this machine. They are not synced to a Project Intelligence cloud account.',
          'AI provider settings and encrypted keys, if you save them, are kept in this app’s local browser storage on the device.',
        ],
      },
      {
        heading: '3. What may leave this computer',
        paragraphs: [
          'If you connect an AI endpoint, file extracts and chat text are sent to that endpoint. If the endpoint is on this computer (typical LM Studio or Ollama setup), that traffic stays local. If you point the app at a remote URL, that host receives the prompts.',
          'Check for updates contacts GitHub to read the latest release. GitHub may see your IP address, a generic app user agent, and that you asked for the latest release. Project files are not sent in that check.',
          'If you download an update, GitHub (or the release asset host) also sees that download request.',
        ],
      },
      {
        heading: '4. Browser storage',
        paragraphs: [
          'The window uses local storage, session storage, and IndexedDB for encrypted keys, UI preferences, and short-lived flags. This app does not use advertising cookies or third-party analytics beacons.',
        ],
      },
      {
        heading: '5. Your choices',
        paragraphs: [
          'You can turn off Improve from past jobs, delete stored examples, remove a saved key, and delete projects or files in the app. Uninstalling the app does not always delete the user-data folder; remove that folder if you want a full local wipe.',
        ],
      },
    ],
  };
}

export function getLegalDocument(kind) {
  const terms = isLocalProduct() ? localTerms() : cloudTerms();
  const privacy = isLocalProduct() ? localPrivacy() : cloudPrivacy();
  const doc = kind === 'privacy' ? privacy : terms;
  return {
    kind: kind === 'privacy' ? 'privacy' : 'terms',
    path: kind === 'privacy' ? '/privacy' : '/terms',
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    productName: PRODUCT_NAME,
    ...doc,
  };
}

export const LEGAL_DOCUMENTS = [getLegalDocument('terms'), getLegalDocument('privacy')];
