Feature: Albums UI flows

  Scenario: Creating an album from the albums page
    Given I am signed in
    When I open "/albums"
    And I create an album through the UI named "Summer album"
    Then the albums page shows the album card "Summer album"
    When I open the album card "Summer album"
    Then the album page shows the empty state

  Scenario: Album search filters the grid by name
    Given I am signed in
    And I created an album via the API named "Beach trip"
    And I created an album via the API named "Mountain hike"
    When I open "/albums"
    Then the albums page lists 2 album cards
    When I search albums for "Beach"
    Then only the album card "Beach trip" is visible

  Scenario: Renaming an album inline
    Given I am signed in
    And I created an album via the API named "Old name"
    When I open the album
    And I rename the album to "New name"
    Then the album title is "New name"
    When I reload the album page
    Then the album title is "New name"
    When I start renaming the album to "Discarded name"
    And I cancel the album rename with Escape
    Then the album title is "New name"

  Scenario: Editing an album description through the prompt
    Given I am signed in
    And I created an album via the API named "Described album"
    When I open the album
    And I edit the album description to "Sunny days by the sea"
    Then the album description is "Sunny days by the sea"
    When I reload the album page
    Then the album description is "Sunny days by the sea"

  Scenario: Deleting an album keeps its photos on the timeline
    Given I am signed in
    And I created an album via the API named "Doomed album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I open the album
    And I delete the album from its options menu
    Then the albums page shows no album cards
    And my timeline still contains the album photo

  Scenario: Adding photos to an album through the dialog
    Given I am signed in
    And I created an album via the API named "Photo album"
    And I uploaded two album photos
    When I open the album
    And I open the add photos dialog
    Then the add photos dialog lists 2 album photos
    When I select all album photos in the dialog
    And I add the selected album photos
    Then the album page shows 2 album photos
    And the first album photo thumbnail loads

  Scenario: Removing a photo from an album keeps it on the timeline
    Given I am signed in
    And I created an album via the API named "Removable album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I open the album
    And I open the first album photo in the viewer
    And I remove the open photo from the album
    Then the album page shows the empty state
    And my timeline still contains the album photo

  Scenario: Unknown album ids show the not-found state
    Given I am signed in
    When I open a missing album page
    Then the album page shows the not-found state

  Scenario: Adding a photo to a new album from the timeline viewer
    Given I am signed in
    And I uploaded "photo.jpg"
    When I click the photo thumbnail
    Then the viewer is open on that photo
    When I open the album picker from the viewer
    And I create an album named "Viewer album" in the picker
    Then the open photo is in the album "Viewer album"
