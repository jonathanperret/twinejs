/**
 A singleton that adapts the Twine interface for NW.js, adding menus and
 syncing changes to the filesystem.  This takes the approach of patching
 existing classes instead of creating a separate set of classes just for NW.js,
 to try to keep things as similar as possible.

 @module nwui
**/

'use strict';
var $ = require('jquery');
var _ = require('underscore');
var Marionette = require('backbone.marionette');
var archive = require('../data/archive');
var locale = require('../locale');
var notify = require('../ui/notify');
var Passage = require('../data/passage');
var StorageQuota = require('../story-list/storage-quota');
var Story = require('../data/story');
var StoryCollection = require('../data/stories');
var StoryListView = require('../story-list/view');
var WelcomeView = require('../welcome/view');
var startupErrorTemplate = require('./startup-error.ejs');
var welcomeViewPatch = require('./welcome-view-patch.ejs');

var nwui = module.exports =
{
	/**
	 Whether Twine is running in a NW.js environment.
	 @const
	**/

	active: 
	window.nwDispatcher !== undefined,

	/**
	 Whether changes to a story should be saved to the filesystem.
	 This is mainly so that internal nwui methods can do their work
	 without tripping over each other.
	**/

	syncFs: true,

	/**
	 While the app is open, we lock story files in the filesystem so
	 that the user can't make changes outside of Twine. This indexes
	 the locks we maintain on these files so we can lift one when
	 deleting a file.
	**/

	fileLocks: {},

	/**
	 Performs one-time initialization, e.g. setting up menus.
	 This should be called as early in the app initialization process
	 as possible.
	**/

	init: function()
	{
		var startupTask = 'beginning startup tasks'; 

		try
		{
			/**
			 An instance of the nw.gui module, for manipulating the native UI.
			 @property gui
			**/

			nwui.gui = require('nw.gui');

			startupTask = 'setting up menus';

			var win = nwui.gui.Window.get();
			var nativeMenuBar = new nwui.gui.Menu({ type: 'menubar' });
			var mainMenu;

			if (process.platform == 'darwin')
			{
				// create Mac menus

				nativeMenuBar.createMacBuiltin(window.app.name);
				mainMenu = _.findWhere(nativeMenuBar.items, { label: '' });

				// add fullscreen item
				// only on OS X for now -- hard to reverse on other platforms
				// if you don't remember the keyboard shortcut

				mainMenu.submenu.insert(new nwui.gui.MenuItem({
					label: locale.say('Toggle Fullscreen'),
					key: 'f',
					modifiers: 'cmd-shift',
					click: function()
					{
						nwui.gui.Window.get().toggleFullscreen();
					}
				}), 0);
			}
			else
			{
				// create a basic menu on other platforms

				mainMenu = new nwui.gui.MenuItem({
					label: window.app.name,
					submenu: new nwui.gui.Menu()
				});

				mainMenu.submenu.append(new nwui.gui.MenuItem({
					label: locale.say('Quit'),
					key: 'q',
					modifiers: 'ctrl',
					click: function()
					{
						nwui.gui.App.closeAllWindows();
					}
				}));

				mainMenu.submenu.insert(new nwui.gui.MenuItem({ type: 'separator' }), 0);
				nativeMenuBar.append(mainMenu);

				// and a stand-in Edit menu

				var editMenu = new nwui.gui.MenuItem({
					label: locale.say('Edit'),
					submenu: new nwui.gui.Menu()
				});

				editMenu.submenu.append(new nwui.gui.MenuItem({
					label: locale.say('Undo'),
					key: 'z',
					modifiers: 'ctrl',
					click: function()
					{
						document.execCommand('undo');
					}
				}));

				editMenu.submenu.append(new nwui.gui.MenuItem({ type: 'separator' }));

				editMenu.submenu.append(new nwui.gui.MenuItem({
					label: locale.say('Cut'),
					key: 'x',
					modifiers: 'ctrl',
					click: function()
					{
						document.execCommand('cut');
					}
				}));

				editMenu.submenu.append(new nwui.gui.MenuItem({
					label: locale.say('Copy'),
					key: 'c',
					modifiers: 'ctrl',
					click: function()
					{
						document.execCommand('copy');
					}
				}));

				editMenu.submenu.append(new nwui.gui.MenuItem({
					label: locale.say('Paste'),
					key: 'v',
					modifiers: 'ctrl',
					click: function()
					{
						document.execCommand('paste');
					}
				}));

				editMenu.submenu.append(new nwui.gui.MenuItem({
					label: locale.say('Delete'),
					click: function()
					{
						document.execCommand('delete');
					}
				}));

				nativeMenuBar.append(editMenu);
			};

			// add item to show story library

			/**
			 An instance of the node path module.
			 @property path
			**/
			nwui.path = require('path');

			mainMenu.submenu.insert(new nwui.gui.MenuItem({
				label: locale.say('Show Library'),
				click: function()
				{
					nwui.gui.Shell.openItem(nwui.filePath.replace(/\//g, nwui.path.sep));
				}
			}), 0);

			win.menu = nativeMenuBar;

			startupTask = 'setting window properties';

			// show window once we're finished loading

			window.onload = function()
			{
				win.show();
				win.focus();
				_.delay(function()
				{
					$('button').blur();
				});
			};

			// shift-ctrl-alt-D shortcut for displaying dev tools

			startupTask = 'adding the debugger keyboard shortcut';

			$('body').on('keyup', function (e)
			{
				if (e.which == 68 && e.shiftKey && e.altKey && e.ctrlKey)
					win.showDevTools();
			});

			// create ~/Documents/Twine if it doesn't exist

			/**
			 An instance of the fs modules, for working with the native filesystem.
			 @property fs
			**/

			startupTask = 'initializing filesystem functions';
			nwui.fs = require('fs');
			startupTask = 'checking for the presence of a Documents or My Documents directory in your user directory';

			// we require this here instead of at the top of the file so that
			// on the web platform, it doesn't try to do any detection 
			// (and fail, because we are not shimming process).

			nwui.osenv = require('osenv');

			/**
			 The path that stories will be saved to in the filesystem.
			 @property filePath
			**/

			var homePath = nwui.osenv.home();

			// if the user doesn't have a Documents folder,
			// check for "My Documents" instead (thanks Windows)

			// L10n: This is the folder name on OS X, Linux, and recent versions of
			// Windows that a user's documents are stored in, relative to the
			// user's home directory. If you need to use a space in this name,
			// then it should have two backslashes (\\) in front of it.
			// Regardless, this must have a single forward slash (/) as its first
			// character.
			var docPath = nwui.path.join(homePath, locale.say('/Documents'));

			if (! nwui.fs.existsSync(docPath))
			{
				startupTask = 'creating a My Documents directory in your user directory';

				// L10n: This is the folder name on Windows XP that a user's
				// documents are stored in, relative to the user's home directory.
				// This is used if a folder with the name given by the translation
				// key '/Documents' does not exist. If you need to use a space in
				// this name, then it should have two backslashes (\\) in front of it.
				// Regardless, this must have a single forward slash (/) as its first character.
				if (nwui.fs.existsSync(nwui.path.join(homePath, locale.say('/My\\ Documents'))))
					docPath = nwui.path.join(homePath, locale.say('/My\\ Documents'));
				else
					nwui.fs.mkdirSync(docPath);
			};

			startupTask = 'checking for the presence of a Twine directory in your Documents directory';

			// L10n: '/Twine' is a suitable name for Twine-related files to exist
			// under on the user's hard drive. '/Stories' is a suitable name for
			// story files specifically. If you need to use a space in this name,
			// then it should have two backslashes in front of it. Regardless,
			// this must have a single forward slash (/) as its first character.
			nwui.filePath = nwui.path.join(docPath, locale.say('/Twine'), locale.say('/Stories'));

			if (! nwui.fs.existsSync(nwui.filePath))
			{
				startupTask = 'creating a Twine directory in your Documents directory';
				var twinePath = nwui.path.join(docPath, locale.say('/Twine'));

				if (! nwui.fs.existsSync(twinePath))
					nwui.fs.mkdirSync(twinePath);

				nwui.fs.mkdirSync(nwui.filePath);
			};

			// do a file sync if we're just starting up
			// we have to stuff this in the global scope;
			// otherwise, each new window will think it's starting afresh
			// and screw up our model IDs

			if (! global.nwuiFirstRun)
			{
				startupTask = 'initially synchronizing story files';
				nwui.syncStoryFiles();
				startupTask = 'initially locking your Stories directory';
				nwui.lockStoryDirectory();
				global.nwuiFirstRun = true;
			};

			startupTask = 'setting up a handler for external links';

			// open external links outside the app

			$('body').on('click', 'a', function (e)
			{
				var url = $(this).attr('href');

				if (typeof url == 'string' && url.match(/^https?:/))
				{
					nwui.gui.Shell.openExternal(url);
					e.preventDefault();
				};
			});

			startupTask = 'setting up shutdown tasks';
		
			// when quitting, unlock the story directory

			process.on('exit', function()
			{
				nwui.unlockStoryDirectory();
			});

			// monkey patch Story to save to a file
			// under ~/Documents/Twine whenever the model changes,
			// or delete it when it is destroyed

			startupTask = 'adding a hook to automatically save stories';

			var oldStoryInit = Story.prototype.initialize;

			Story.prototype.initialize = function()
			{
				oldStoryInit.call(this);
				
				this.on('change', _.throttle(function()
				{
					// if the only thing that is changing is last modified date,
					// then skip it
					
					if (! _.some(_.keys(this.changedAttributes()), function (key)
					{
						return (key != 'lastUpdated');
					}))
						return;
					
					// if we aren't syncing changes or the story has no passages,
					// give up early

					if (! nwui.syncFs || this.fetchPassages().length === 0)
						return;

					nwui.saveStoryFile(this);
				}, 100), this);

				this.on('destroy', function()
				{
					if (! nwui.syncFs)
						return;

					nwui.deleteStoryFile(this);
				}, this);
			};

			// monkey patch Passage to save its parent story whenever
			// it is changed or destroyed

			startupTask = 'adding a hook to automatically save a story after editing a passage';

			var oldPassageInit = Passage.prototype.initialize;

			Passage.prototype.initialize = function()
			{
				oldPassageInit.call(this);

				this.on('change destroy', _.debounce(function()
				{
					if (! nwui.syncFs)
						return;

					// if we have no parent, skip it
					// (this happens during an import, for example)

					var parent = this.fetchStory();

					if (parent)
						nwui.saveStoryFile(parent);
				}, 100), this);
			};

			// monkey patch StorageQuota to hide itself, since we
			// don't have to sweat quota ourselves

			startupTask = 'disabling the storage quota meter';

			StorageQuota.prototype.render = function()
			{
				this.$el.css('display', 'none');
			};

			// monkey patch StoryListView to open the wiki in the user's browser
			// and to hold off on trying to update the filesystem midprocess

			startupTask = 'setting up the Help link';

			StoryListView.prototype.events['click .showHelp'] = function()
			{
				nwui.gui.Shell.openExternal('http://twinery.org/2guide');
			};

			startupTask = 'setting up a hook for importing story files';

			var oldStoryListViewImportFile = StoryListView.prototype.importFile;

			StoryListView.prototype.importFile = function (e)
			{
				nwui.syncFs = false;
				var reader = oldStoryListViewImportFile.call(this, e);
				reader.addEventListener('load', function()
				{
					// deferred to make sure that the normal event
					// handler fires first

					_.defer(function()
					{
						nwui.syncFs = true;
						StoryCollection.all().each(nwui.saveStoryFile);
					});
				});
			};

			// monkey patch WelcomeView to display a different message
			// about saving

			startupTask = 'customizing the initial welcome page';

			var oldWelcomeViewRender = WelcomeView.prototype.onRender;

			WelcomeView.prototype.onRender = function()
			{
				this.$('.save').html(Marionette.Renderer.render(welcomeViewPatch, {}));
				oldWelcomeViewRender.call(this);
			};
		}
		catch (e)
		{
			/*eslint-disable no-console*/
			console.log('Startup crash', startupTask, e);
			/*eslint-enable no-console*/
			document.write(startupErrorTemplate({ task: startupTask, error: e }));
			throw e;
		};
	},

	/**
	 Returns a filename for a story model that's guaranteed to be
	 safe across all platforms. For this, we use POSIX's definition
	 (http://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap03.html#tag_03_276)
	 with the addition of spaces, for legibility.

	 @param {Story} story Story model to create filename for
	**/

	storyFileName: function (story)
	{
		return story.get('name').replace(/[^\w\. -]/g, '_') + '.html';
	},

	/**
	 Saves a story model to the file system. If a problem occurs,
	 then a notification is shown to the user.

	 @param {Story} story Story model to save
	**/

	saveStoryFile: function (story)
	{
		try
		{
			nwui.unlockStoryDirectory();
			var fd = nwui.fs.openSync(nwui.filePath + '/' + nwui.storyFileName(story), 'w');
			nwui.fs.writeSync(fd, story.publish(null, null, true));
			nwui.fs.closeSync(fd);
		}
		catch (e)
		{
			// L10n: %s is the error message.
			notify(locale.say('An error occurred while saving your story (%s).', e.message), 'danger');
			throw e;
		}
		finally
		{
			nwui.lockStoryDirectory();
		};
	},

	/**
	 Deletes a story file from the file system. If a problem occurs,
	 then a notification is shown to the user.

	 @param {Story} story Story model to delete
	**/

	deleteStoryFile: function (story)
	{
		try
		{
			nwui.unlockStoryDirectory();
			nwui.fs.unlinkSync(nwui.filePath + '/' + nwui.storyFileName(story));
		}
		catch (e)
		{
			// L10n: %s is the error message.
			notify(locale.say('An error occurred while deleting your story (%s).', e.message), 'danger');
		}
		finally
		{
			nwui.lockStoryDirectory();
		};
	},

	/**
	 Syncs local storage with the file system, obliterating
	 any stories that happen to be saved to local storage only.
	**/

	syncStoryFiles: function()
	{
		nwui.syncFs = false;

		// clear all existing stories and passages

		var allStories = StoryCollection.all();

		while (allStories.length > 0)
			allStories.at(0).destroy();

		// read from files

		nwui.unlockStoryDirectory();

		var fileStories = nwui.fs.readdirSync(nwui.filePath);

		_.each(fileStories, function (filename)
		{
			if (filename.match(/\.html$/))
			{
				var stats = nwui.fs.statSync(nwui.filePath + '/' + filename);
				archive.import(nwui.fs.readFileSync(nwui.filePath + '/' + filename, { encoding: 'utf-8' }),
				               new Date(Date.parse(stats.mtime)));
			};
		});

		nwui.unlockStoryDirectory();
		nwui.syncFs = true;
	},

	/**
	 Locks the story directory to prevent the user from changing it
	 outside of Twine. The init() method must be called first.
	**/

	lockStoryDirectory: function()
	{
		try
		{
			if (process.platform == 'win32')
				_.each(nwui.fs.readdirSync(nwui.filePath), function (filename)
				{
					nwui.fs.chmodSync(nwui.filePath + '/' + filename, 292); // a-w, 0444
				});
			else
			{
				var stat = nwui.fs.statSync(nwui.filePath);
				nwui.fs.chmodSync(nwui.filePath, stat.mode ^ 128); // u-w
			};
		}
		catch (e)
		{
			// L10n: Locking in the sense of preventing changes to a file. %s is the error message.
			notify(locale.say('An error occurred while locking your library (%s).', e.message), 'danger');
		};
	},

	/**
	 Unlocks the story directory. The init() method must be called
	 first.
	**/

	unlockStoryDirectory: function()
	{
		try
		{
			if (process.platform == 'win32')
				_.each(nwui.fs.readdirSync(nwui.filePath), function (filename)
				{
					nwui.fs.chmodSync(nwui.filePath + '/' + filename, 438); // a+w, 0666
				});
			else
			{
				var stat = nwui.fs.statSync(nwui.filePath);
				nwui.fs.chmodSync(nwui.filePath, stat.mode | 128); // u+w
			};
		}
		catch (e)
		{
			// L10n: Unlocking in the sense of allowing changes to a file. %s is the error message.
			notify(locale.say('An error occurred while unlocking your library (%s).', e.message), 'danger');
		};
	}
};
