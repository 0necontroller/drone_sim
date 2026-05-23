'use client';

import { useEffect } from 'react';

import 'vanilla-cookieconsent/dist/cookieconsent.css';
import * as CookieConsent from 'vanilla-cookieconsent';

export default function MyCookieConsent() {
	useEffect(() => {
		CookieConsent.run({
			categories: {
				necessary: {
					enabled: true, // this category is enabled by default
					readOnly: true // this category cannot be disabled
				},
				analytics: {}
			},
			language: {
				default: 'en',
				translations: {
					en: {
						consentModal: {
							title: 'We use cookies',
							description:
								'Our website uses tracking cookies to understand how you interact with it. The tracking will be enabled only if you accept explicitly.',
							acceptAllBtn: 'Accept all',
							acceptNecessaryBtn: 'Only necessary',
							showPreferencesBtn: 'Manage Individual preferences',
							footer: `
                        <a href="/legal/privacy" target="_blank">Privacy Policy</a>
                    `
						},
						preferencesModal: {
							title: 'Manage cookie preferences',
							acceptAllBtn: 'Accept all',
							acceptNecessaryBtn: 'Only accept necessary',
							savePreferencesBtn: 'Accept current selection',
							closeIconLabel: 'Close modal',
							sections: [
								{
									title: 'Cookie Usage',
									description:
										'We use cookies to ensure the basic functionalities of the website and to enhance your online experience. You can choose for each category to opt-in/out whenever you want. For more details relative to cookies and other sensitive data, please read the full <a href="/lega/privacy">privacy policy</a>'
								},
								{
									title: 'Strictly Necessary',
									description:
										'These cookies are essential for the proper functioning of the website and cannot be disabled.'
								},
								{
									title: 'Strictly Necessary cookies',
									description:
										'These cookies are essential for the proper functioning of the website and cannot be disabled.',

									//this field will generate a toggle linked to the 'necessary' category
									linkedCategory: 'necessary'
								},
								{
									title: 'More information',
									description:
										'For any queries in relation to my policy on cookies and your choices, please <a href="#contact-page">contact us</a>'
								}
							]
						}
					}
				}
			}
		});
	}, []);

	return null;
}
