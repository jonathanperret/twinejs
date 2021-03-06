const $ = require('jquery');
const locale = require('../locale');

// function to do the actual work of showing/hiding collapsible elements
// syntax is $(...).collapse('show' | 'hide' | 'toggle')

$.fn.collapse = function(action) {
	const $t = $(this);
	const $cont = $t.closest('.collapseContainer');

	switch (action) {
		case 'show':
			$cont.addClass('revealed').find('.collapse').slideDown();
			break;

		case 'hide':
			$cont.removeClass('revealed').find('.collapse').slideUp();
			break;

		case 'toggle':
			if ($cont.hasClass('revealed')) {
				$t.collapse('hide');
			}
			else {
				$t.collapse('show');
			}

			break;

		default:
			// L10n: An internal error message related to UI components.
			throw new Error(
				locale.say('Don\'t know how to do collapse action %s', action)
			);
	}

	return this;
};
