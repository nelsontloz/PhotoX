Feature: Favorites

  Scenario: Favorites start empty
    Given I am signed in
    When I open "/favorites"
    Then the favorites page shows the empty state

  Scenario: Favoriting from the timeline then unfavoriting from the favorites viewer
    Given I am signed in
    And I uploaded "photo.jpg"
    When I click the photo thumbnail
    Then the viewer marks the asset as not a favorite
    When I click the favorite control in the viewer
    Then the viewer marks the asset as a favorite
    When I open "/favorites"
    Then the favorites grid shows exactly one item
    And the favorites thumbnail image finishes loading
    When I click the photo thumbnail
    Then the viewer marks the asset as a favorite
    When I click the favorite control in the viewer
    Then the favorites page shows the empty state

  Scenario: Favorited assets are grouped under their day
    Given I am signed in
    And I uploaded "photo.jpg"
    When I set the uploaded asset date for favorites grouping
    And I favorite the uploaded asset through the favorites API
    When I open "/favorites"
    Then the favorites grid shows exactly one item
    And the favorites grid groups the asset under the pinned date
