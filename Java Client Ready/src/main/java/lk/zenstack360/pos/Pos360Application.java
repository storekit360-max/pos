package lk.zenstack360.pos;

import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.web.WebView;
import javafx.stage.Stage;

public final class Pos360Application extends Application {
    @Override public void start(Stage stage) {
        WebView web = new WebView();
        web.setContextMenuEnabled(true);
        web.getEngine().load(getClass().getResource("/pos/index.html").toExternalForm());
        stage.setTitle("POS360 Java Client — Integration Preview");
        stage.setMinWidth(1024); stage.setMinHeight(700);
        stage.setScene(new Scene(web, 1360, 860)); stage.show();
    }
    public static void main(String[] args) { launch(args); }
}
