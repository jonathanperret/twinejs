/**
 A collection of stories. This sorts stories by name by default.

 @class StoryCollection
 @extends Backbone.Collection
**/

'use strict';
const Backbone = require('backbone');
const EventedLocalStorage = require('../../backbone-ext/evented-local-storage');

const StoryCollection = Backbone.Collection.extend({
	localStorage: new EventedLocalStorage('twine-stories'),
	order: 'name',
	reverseOrder: false,

	comparator(a, b) {
		let sortVal;
		
		switch (this.order) {
			case 'name':
				sortVal = a.get('name') < b.get('name') ? -1 : 1;
				break;

			case 'lastUpdate':
				const aDate = new Date(a.get('lastUpdate'));
				const bDate = new Date(b.get('lastUpdate'));

				sortVal = aDate.getTime() < bDate.getTime() ? -1 : 1;
				break;
			
			default:
				// FIXME
				// L10n: An internal error. %s is a bad sort criterion.
				throw new Error(
					window.app.say('don\'t know how to sort stories by %s',
					this.order
				));
		};

		return sortVal * (this.reverseOrder ? -1 : 1);
	}
});

// early export to avoid circular reference problems

module.exports = StoryCollection;
const Story = require('../models/story');

StoryCollection.prototype.model = Story;

/**
 Returns a collection of all stories saved.

 @method all
 @return {StoryCollection} a collection of all stories
 @static
**/

StoryCollection.all = () => {
	const result = new StoryCollection();

	result.fetch();
	return result;
};

