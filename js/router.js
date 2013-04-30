define(['jquery', 'backbone', 'views/storylistview', 'views/storyeditview', 'templates/default'],

function ($, Backbone, StoryListView, StoryEditView, defaultTemplate)
{
	var TwineRouter = Backbone.Router.extend(
	{
		routes:
		{
			'stories': function()
			{
				// list of all stories

				window.app.stories.fetch(
				{
					success: function (stories)
					{
						window.app.mainRegion.show(new StoryListView({ collection: stories }));
					}
				});
			},

			'stories/:id': function (id)
			{
				// editing a specific story

				window.app.stories.fetch(
				{
					success: function (stories)
					{
						window.app.passages.fetch(
						{
							success: function()
							{
								window.app.mainRegion.show(new StoryEditView({ model: stories.get(id) }));
							}
						});
					}
				});
			},

			'stories/:id/play': function (id)
			{
				// play a story

				window.app.stories.fetch(
				{
					success: function (stories)
					{
						window.app.passages.fetch(
						{
							success: function()
							{
								defaultTemplate.publish(stories.get(id), function (html)
								{
									// inject head and body separately -- otherwise DOM errors crop up

									$('head').html(html.substring(html.indexOf('<head>') + 6, html.indexOf('</head>')));
									$('body').html(html.substring(html.indexOf('<body>') + 6, html.indexOf('</body>')));
								});
							}
						});
					}
				});
			},

			'*path': function()
			{
				// default route -- show story list
				
				window.location.hash = '#stories';
			}
		}
	});

	return TwineRouter;
});
