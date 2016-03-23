/**
 Allows the user to pick what locale they would like to use.

 @class LocaleView
 @extends Backbone.Marionette.ItemView
**/

'use strict';
const $ = require('jquery');
const Marionette = require('backbone.marionette');
const locale = require('./index.js');
const AppPref = require('../data/models/app-pref');
const localeTemplate = require('./ejs/locale-view.ejs');

module.exports = Marionette.ItemView.extend({
	template: localeTemplate,

	/**
	 Sets the application locale and forces a window reload
	 back to the story list.

	 @method setLocale
	 @param {String} userLocale locale to set
	**/

	setLocale(userLocale) {
		if (typeof userLocale !== 'string') {
			// L10n: An internal error when changing locale.
			throw new Error(
				locale.say('Can\'t set locale to nonstring: %s', userLocale)
			);
		}

		AppPref.withName('locale').save({ value: userLocale });
		window.location.hash = 'stories';
		window.location.reload();
	},

	events: {
		'click [data-locale]'(e) {
			this.setLocale($(e.target).closest('[data-locale]').data('locale'));
		}
	}
});